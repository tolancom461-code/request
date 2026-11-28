import { Body, Controller, Get, HttpException, HttpStatus, Inject, Injectable, Module, Param, Post, Req, Res } from "@nestjs/common";
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
import { ItemsController } from "./items.controller.js";
import { ItemsService } from "./items.service.js";
import { ItemSetupController } from "./item-setup.controller.js";
import { ItemSetupService } from "./item-setup.service.js";
import { ItemSupplierService } from "./item-supplier.service.js";
import { DocumentNumberingService } from "./document-numbering.service.js";
import { DocumentNumberingController } from "./document-numbering.controller.js";
import { AccessGuard, AccessService, BranchScopeService, Permissions, Public, type AuthenticatedRequest, type UserAccess } from "./security.js";
import { SessionService } from "./session.service.js";
import { StorageService } from "./storage.service.js";
import { RequisitionController } from "./requisition.controller.js";
import { RequisitionService } from "./requisition.service.js";
import { ManagerApprovalController } from "./manager-approval.controller.js";
import { ManagerApprovalService } from "./manager-approval.service.js";
import { WarehouseOperationsController } from "./warehouse-operations.controller.js";
import { WarehouseOperationsService } from "./warehouse-operations.service.js";
import { PurchaseController, PurchaseHistoryController } from "./purchase.controller.js";
import { PurchaseService } from "./purchase.service.js";
import { NotificationController } from "./notification.controller.js";
import { NotificationService } from "./notification.service.js";
import { AuditActivityController } from "./audit-activity.controller.js";
import { AuditActivityService } from "./audit-activity.service.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

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
      const details = typeof responseBody === "string" ? { message: responseBody } : responseBody as { code?: string; message?: string };
      return response.status(statusCode).send({ statusCode, code: details.code ?? "HTTP_ERROR", message: details.message ?? "Request failed.", path: request.url });
    }
    console.error(JSON.stringify({ event: "unhandled_error", path: request.url, error: error instanceof Error ? error.message : "unknown" }));
    return response.status(500).send({ statusCode: 500, code: "INTERNAL_ERROR", message: "An unexpected error occurred.", path: request.url });
  }
}

const loginSchema = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(256) });

function sessionUser({ id, username, email, status, roles, permissions }: UserAccess) {
  return { id, username, email, status, roles, permissions };
}

@Controller("auth")
@Permissions()
class AuthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccessService) private readonly access: AccessService,
  ) {}

  @Public()
  @Post("login")
  async login(@Body() rawBody: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const { username, password } = loginSchema.parse(rawBody);
    const user = await this.prisma.user.findUnique({ where: { username } });
    const argon2 = await import("argon2");
    if (!user || !user.passwordHash || user.status !== "active" || user.deletedAt || !(await argon2.verify(user.passwordHash, password))) {
      throw new HttpException("Invalid credentials.", HttpStatus.UNAUTHORIZED);
    }
    const access = await this.access.forUser(user.id);
    const session = await this.sessions.create(user.id);
    this.sessions.setCookie(reply, session);
    return { user: sessionUser(access), csrfToken: session.csrfToken };
  }

  @Get("me")
  me(@Req() request: AuthenticatedRequest) {
    return { user: sessionUser(request.restaurantAccess) };
  }

  @Get("csrf")
  csrf(@Req() request: AuthenticatedRequest) {
    return { csrfToken: request.restaurantSession.csrfToken };
  }

  @Post("logout")
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.destroy(request.restaurantSession.id);
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
  constructor(@Inject(BranchScopeService) private readonly branchScopes: BranchScopeService, @Inject(RequisitionService) private readonly requisitions: RequisitionService) {}

  @Get("branch/:branchId")
  @Permissions("branch.read")
  async branchScope(@Req() request: AuthenticatedRequest) {
    const branchId = (request.params as { branchId: string }).branchId;
    await this.branchScopes.assertAllowed(request.restaurantSession.userId, branchId);
    return { allowed: true, branchId };
  }

  @Post("manager-action")
  @Permissions("request.manager.review")
  managerAction() {
    return { allowed: true, scope: "manager" };
  }

  @Post("warehouse-action")
  @Permissions("warehouse.process")
  warehouseAction() {
    return { allowed: true, scope: "warehouse" };
  }

  @Post("admin-action")
  @Permissions("admin.manage")
  adminAction() {
    return { allowed: true, scope: "admin" };
  }

  @Post("requests/:requestId/submit-first-time")
  @Permissions("request.submit")
  submit(@Req() request: AuthenticatedRequest, @Param("requestId") requestId: string) {
    return this.requisitions.submitDraft(request.restaurantSession.userId, z.string().uuid().parse(requestId));
  }
}

@Module({
  controllers: [AuthController, HealthController, FoundationController, AdminController, DocumentNumberingController, AuditActivityController, ReportsController, ItemSetupController, ItemsController, RequisitionController, ManagerApprovalController, WarehouseOperationsController, PurchaseController, PurchaseHistoryController, NotificationController],
  providers: [
    PrismaService,
    SessionService,
    AccessService,
    StorageService,
    BranchScopeService,
    RequestSubmissionService,
    RequestLinePreparationService,
    ItemSupplierService,
    DocumentNumberingService,
    MasterDataIntegrityService,
    AdminService,
    ItemsService,
    ItemSetupService,
    RequisitionService,
    ManagerApprovalService,
    WarehouseOperationsService,
    PurchaseService,
    NotificationService,
    AuditActivityService,
    ReportsService,
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
