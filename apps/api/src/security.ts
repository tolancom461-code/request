import { AsyncLocalStorage } from "node:async_hooks";
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PrismaService } from "./prisma.service.js";
import { SessionService, type SessionRecord } from "./session.service.js";

export type UserAccess = {
  id: string;
  username: string;
  email: string | null;
  status: "active";
  roles: string[];
  permissions: string[];
  branchIds: string[];
};

export type AuthenticatedRequest = FastifyRequest & {
  restaurantSession: SessionRecord;
  restaurantAccess: UserAccess;
};

const IS_PUBLIC = "isPublic";
const REQUIRED_PERMISSIONS = "requiredPermissions";
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Permissions = (...permissions: string[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

const metadata = <T>(key: string, context: ExecutionContext): T | undefined =>
  Reflect.getMetadata(key, context.getHandler()) ?? Reflect.getMetadata(key, context.getClass());

type AccessRow = Pick<UserAccess, "id" | "username" | "email"> & {
  roleCode: string | null;
  permissionCode: string | null;
  branchId: string | null;
};

@Injectable()
export class AccessService {
  private readonly requestContext = new AsyncLocalStorage<{ access?: UserAccess }>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  runRequest(next: () => void) {
    this.requestContext.run({}, next);
  }

  async forUser(userId: string): Promise<UserAccess> {
    const context = this.requestContext.getStore();
    if (context?.access?.id === userId) return context.access;

    // Keep the scope rows separate from the grants to avoid multiplying roles by branches.
    const rows = await this.prisma.$queryRaw<AccessRow[]>`
      SELECT u.id, u.username, u.email, r.code AS roleCode, p.code AS permissionCode, NULL AS branchId
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = ${userId} AND u.status = 'active' AND u.deleted_at IS NULL
      UNION ALL
      SELECT u.id, u.username, u.email, NULL, NULL, s.branch_id
      FROM users u
      JOIN user_branch_scopes s ON s.user_id = u.id
      WHERE u.id = ${userId} AND u.status = 'active' AND u.deleted_at IS NULL`;
    const user = rows[0];
    if (!user) throw new UnauthorizedException("Authentication is required.");
    const roles = new Set<string>();
    const permissions = new Set<string>();
    const branchIds = new Set<string>();
    for (const row of rows) {
      if (row.roleCode) roles.add(row.roleCode);
      if (row.permissionCode) permissions.add(row.permissionCode);
      if (row.branchId) branchIds.add(row.branchId);
    }
    const access: UserAccess = {
      id: user.id, username: user.username, email: user.email, status: "active",
      roles: [...roles], permissions: [...permissions], branchIds: [...branchIds],
    };
    if (context) context.access = access;
    return access;
  }
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccessService) private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (metadata<boolean>(IS_PUBLIC, context)) return true;
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const session = await this.sessions.get(this.sessions.requestSessionId(request));
    if (!session) throw new UnauthorizedException("Authentication is required.");

    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      this.sessions.assertCsrf(session, request.headers["x-csrf-token"] as string | undefined, request.headers.origin);
    }

    const access = await this.access.forUser(session.userId);
    const required = metadata<string[]>(REQUIRED_PERMISSIONS, context);
    if (!required || !required.every(permission => access.permissions.includes(permission))) {
      throw new ForbiddenException({ code: "PERMISSION_REQUIRED", message: "Required permission is missing." });
    }
    request.restaurantSession = session;
    request.restaurantAccess = access;
    this.sessions.setCookie(http.getResponse<FastifyReply>(), session);
    return true;
  }
}

export type BranchScope = { isSystemAdmin: boolean; branchIds: string[] };

@Injectable()
export class BranchScopeService {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  async scopeFor(userId: string, branchId?: string): Promise<BranchScope> {
    const access = await this.access.forUser(userId);
    const scope = { isSystemAdmin: access.roles.includes("system_admin"), branchIds: access.branchIds };
    if (branchId && !scope.isSystemAdmin && !scope.branchIds.includes(branchId)) {
      throw new ForbiddenException("The user is not authorized for this branch.");
    }
    return scope;
  }

  async assertAllowed(userId: string, branchId: string) {
    await this.scopeFor(userId, branchId);
  }
}
