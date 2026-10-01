import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PrismaService } from "./prisma.service.js";
import { SessionService, type SessionRecord } from "./session.service.js";

type RequestWithSession = FastifyRequest & { restaurantSession?: SessionRecord };
export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const REQUIRED_PERMISSIONS = "requiredPermissions";
export const Permissions = (...permissions: string[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

const metadata = <T>(key: string, context: ExecutionContext): T | undefined =>
  Reflect.getMetadata(key, context.getHandler()) ?? Reflect.getMetadata(key, context.getClass());

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext) {
    if (metadata<boolean>(IS_PUBLIC, context)) return true;
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const session = await this.sessions.get(this.sessions.requestSessionId(request));
    if (!session) throw new UnauthorizedException("Authentication is required.");
    request.restaurantSession = session;
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext) {
    if (metadata<boolean>(IS_PUBLIC, context)) return true;
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    if (!request.restaurantSession) throw new UnauthorizedException("Authentication is required.");
    this.sessions.assertCsrf(request.restaurantSession, request.headers["x-csrf-token"] as string | undefined, request.headers.origin);
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const required = metadata<string[]>(REQUIRED_PERMISSIONS, context) ?? [];
    if (required.length === 0) return true;
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    if (!request.restaurantSession) throw new UnauthorizedException("Authentication is required.");
    const memberships = await this.prisma.userRole.findMany({
      where: { userId: request.restaurantSession.userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const granted = new Set(memberships.flatMap((membership) => membership.role.permissions.map((entry) => entry.permission.code)));
    if (!required.every((permission) => granted.has(permission))) throw new ForbiddenException("Required permission is missing.");
    return true;
  }
}

@Injectable()
export class BranchScopeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async assertAllowed(userId: string, branchId: string) {
    const admin = await this.prisma.userRole.findFirst({ where: { userId, role: { code: "system_admin" } } });
    if (admin) return;
    const scope = await this.prisma.userBranchScope.findUnique({ where: { userId_branchId: { userId, branchId } } });
    if (!scope) throw new ForbiddenException("The user is not authorized for this branch.");
  }
}
