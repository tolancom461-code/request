import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";

export type AuditListInput = {
  page: number;
  pageSize: number;
  actorUserId?: string;
  actorType?: ActorType;
  entityType?: string;
  entityId?: string;
  action?: string;
  search?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
  sort: "occurredAt" | "action" | "entityType";
  direction: "asc" | "desc";
};

const secretKey = /^(?:password|passwordhash|session|sessionid|csrf|token|secret|credential|dsn|databaseurl|redisurl|key|object.*key|storage.*key|access.*key|private.*key)$/i;

function redacted(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => redacted(entry)) as Prisma.JsonArray;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, secretKey.test(key.replace(/[_-]/g, "")) ? "[REDACTED]" : redacted(entry ?? null)])) as Prisma.JsonObject;
}

@Injectable()
export class AuditActivityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private page<T>(input: AuditListInput, total: number, items: T[]) {
    return { items, page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) };
  }

  private safe(row: { id: string; actorType: ActorType; actorUserId: string | null; entityType: string; entityId: string; action: string; beforeData: Prisma.JsonValue | null; afterData: Prisma.JsonValue | null; occurredAt: Date; actorUser: { id: string; username: string; email: string | null } | null }) {
    return { id: row.id, actorType: row.actorType, actorUserId: row.actorUserId, actorUser: row.actorUser, entityType: row.entityType, entityId: row.entityId, action: row.action, beforeData: redacted(row.beforeData), afterData: redacted(row.afterData), occurredAt: row.occurredAt };
  }

  private where(input: AuditListInput, actorUserId?: string): Prisma.AuditLogWhereInput {
    return {
      ...(actorUserId ? { actorUserId } : input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.actorType ? { actorType: input.actorType } : {}),
      ...(input.entityType ? { entityType: { contains: input.entityType } } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
      ...(input.action ? { action: { contains: input.action } } : {}),
      ...(input.occurredFrom || input.occurredTo ? { occurredAt: { ...(input.occurredFrom ? { gte: input.occurredFrom } : {}), ...(input.occurredTo ? { lte: input.occurredTo } : {}) } } : {}),
      ...(input.search ? { OR: [{ action: { contains: input.search } }, { entityType: { contains: input.search } }, { entityId: { contains: input.search } }, { actorUser: { username: { contains: input.search } } }] } : {}),
    };
  }

  private async query(input: AuditListInput, actorUserId?: string) {
    const where = this.where(input, actorUserId);
    const orderBy = [{ [input.sort]: input.direction } as Prisma.AuditLogOrderByWithRelationInput, { id: input.direction } as Prisma.AuditLogOrderByWithRelationInput];
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy, skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { actorUser: { select: { id: true, username: true, email: true } } } }),
    ]);
    return this.page(input, total, rows.map((row) => this.safe(row)));
  }

  listAudit(input: AuditListInput) { return this.query(input); }

  async userActivity(userId: string, input: AuditListInput) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, email: true, status: true, deletedAt: true } });
    if (!user) throw new NotFoundException("User was not found.");
    const activity = await this.query(input, userId);
    return { user, ...activity };
  }
}
