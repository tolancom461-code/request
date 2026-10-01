import { Body, Controller, Get, HttpException, HttpStatus, Inject, Injectable, Module, Post, Req, Res, UseGuards } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError, z } from "zod";
import { loadConfig } from "./config.js";
import { PrismaService } from "./prisma.service.js";
import { RequestSubmissionService } from "./request-submission.service.js";
import { RequestLinePreparationService } from "./request-line-preparation.service.js";
import { MasterDataIntegrityService } from "./master-data-integrity.service.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { BranchItemSuppliersController, ItemsController } from "./items.controller.js";
import { ItemsService } from "./items.service.js";
import { PrimarySupplierTemporalService } from "./primary-supplier-temporal.service.js";
import { BranchScopeService, CsrfGuard, Permissions, PermissionsGuard, Public, SessionGuard } from "./security.js";
import { SessionService, type SessionRecord } from "./session.service.js";
import { StorageService } from "./storage.service.js";
import { RequisitionController } from "./requisition.controller.js";
import { RequisitionService } from "./requisition.service.js";
import { ManagerApprovalController } from "./manager-approval.controller.js";
import { ManagerApprovalService } from "./manager-approval.service.js";
import { WarehouseOperationsController } from "./warehouse-operations.controller.js";
import { WarehouseOperationsService } from "./warehouse-operations.service.js";
import { NotificationController } from "./notification.controller.js";
import { NotificationService } from "./notification.service.js";
import { AuditActivityController } from "./audit-activity.controller.js";
import { AuditActivityService } from "./audit-activity.service.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

type RequestWithSession = FastifyRequest & { restaurantSession?: SessionRecord };

@Injectable()
class HttpErrorFilter {
  catch(error: unknown, host: import("@nestjs/common").ArgumentsHost) {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    if (error instanceof ZodError) {
      return response.status(400).send({ statusCode: 400, code: "VALIDATION_ERROR", message: "Invalid request input.", path: request.url, issues: error.flatten() });
    }
    if (error instanceof HttpException) {
      const statusCode = error.getStatus();
      const responseBody = error.getResponse();
      return response.status(statusCode).send({ statusCode, code: "HTTP_ERROR", message: typeof responseBody === "string" ? responseBody : (responseBody as { message?: string }).message ?? "Request failed.", path: request.url });
    }
    console.error(JSON.stringify({ event: "unhandled_error", path: request.url, error: error instanceof Error ? error.message : "unknown" }));
    return response.status(500).send({ statusCode: 500, code: "INTERNAL_ERROR", message: "An unexpected error occurred.", path: request.url });
  }
}

const loginSchema = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(256) });

@Controller("auth")
class AuthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(SessionService) private readonly sessions: SessionService) {}

  @Public()
  @Post("login")
  async login(@Body() rawBody: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const { username, password } = loginSchema.parse(rawBody);
    const user = await this.prisma.user.findUnique({ where: { username } });
    const argon2 = await import("argon2");
    if (!user || !user.passwordHash || user.status !== "active" || !(await argon2.verify(user.passwordHash, password))) {
      throw new HttpException("Invalid credentials.", HttpStatus.UNAUTHORIZED);
    }
    const session = await this.sessions.create(user.id);
    this.sessions.setCookie(reply, session);
    return { user: { id: user.id, username: user.username, email: user.email }, csrfToken: session.csrfToken };
  }

  @Get("me")
  async me(@Req() request: RequestWithSession) {
    const user = await this.prisma.user.findUnique({
      where: { id: request.restaurantSession!.userId },
      select: { id: true, username: true, email: true, status: true, roles: { select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } } },
    });
    if (!user) return { user: null };
    return { user: { id: user.id, username: user.username, email: user.email, status: user.status, permissions: [...new Set(user.roles.flatMap((entry) => entry.role.permissions.map((permission) => permission.permission.code)))] } };
  }

  @Get("csrf")
  csrf(@Req() request: RequestWithSession) {
    return { csrfToken: request.restaurantSession!.csrfToken };
  }

  @Post("logout")
  async logout(@Req() request: RequestWithSession, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.destroy(request.restaurantSession!.id);
    this.sessions.clearCookie(reply);
    return { success: true };
  }
}

@Controller("health")
class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(SessionService) private readonly sessions: SessionService) {}

  @Public()
  @Get("live")
  live() {
    return { status: "ok", version: loadConfig().APP_VERSION };
  }

  @Public()
  @Get("ready")
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    const sessionStore = await this.sessions.health();
    return { status: "ready", database: "ok", sessionStore };
  }
}

@Controller("foundation")
class FoundationController {
  constructor(@Inject(BranchScopeService) private readonly branchScopes: BranchScopeService, @Inject(RequestSubmissionService) private readonly submissions: RequestSubmissionService) {}

  @Get("branch/:branchId")
  @UseGuards(PermissionsGuard)
  @Permissions("branch.read")
  async branchScope(@Req() request: RequestWithSession) {
    const branchId = (request.params as { branchId: string }).branchId;
    await this.branchScopes.assertAllowed(request.restaurantSession!.userId, branchId);
    return { allowed: true, branchId };
  }

  @Post("manager-action")
  @UseGuards(PermissionsGuard)
  @Permissions("request.manager.review")
  managerAction() {
    return { allowed: true, scope: "manager" };
  }

  @Post("warehouse-action")
  @UseGuards(PermissionsGuard)
  @Permissions("warehouse.process")
  warehouseAction() {
    return { allowed: true, scope: "warehouse" };
  }

  @Post("admin-action")
  @UseGuards(PermissionsGuard)
  @Permissions("admin.manage")
  adminAction() {
    return { allowed: true, scope: "admin" };
  }

  @Post("requests/:requestId/submit-first-time")
  @UseGuards(PermissionsGuard)
  @Permissions("request.submit")
  submit(@Req() request: RequestWithSession) {
    const requestId = (request.params as { requestId: string }).requestId;
    return this.submissions.submitFirstTime(requestId, request.restaurantSession!.userId);
  }
}

@Module({
  controllers: [AuthController, HealthController, FoundationController, AdminController, AuditActivityController, ReportsController, ItemsController, BranchItemSuppliersController, RequisitionController, ManagerApprovalController, WarehouseOperationsController, NotificationController],
  providers: [
    PrismaService,
    SessionService,
    StorageService,
    BranchScopeService,
    RequestSubmissionService,
    RequestLinePreparationService,
    PrimarySupplierTemporalService,
    MasterDataIntegrityService,
    AdminService,
    ItemsService,
    RequisitionService,
    ManagerApprovalService,
    WarehouseOperationsService,
    NotificationService,
    AuditActivityService,
    ReportsService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
