import { Controller, Get, Inject, Param, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ActorType } from "@prisma/client";
import { z } from "zod";
import { AuditActivityService, type AuditListInput } from "./audit-activity.service.js";
import { Permissions, PermissionsGuard } from "./security.js";

const id = z.string().uuid();
const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  actorUserId: id.optional(),
  actorType: z.nativeEnum(ActorType).optional(),
  entityType: z.string().trim().max(100).optional(),
  entityId: id.optional(),
  action: z.string().trim().max(120).optional(),
  search: z.string().trim().max(160).optional(),
  occurredFrom: z.string().datetime().optional(),
  occurredTo: z.string().datetime().optional(),
  sort: z.enum(["occurredAt", "action", "entityType"]).default("occurredAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

const input = (raw: unknown): AuditListInput => {
  const parsed = query.parse(raw);
  return { ...parsed, occurredFrom: parsed.occurredFrom ? new Date(parsed.occurredFrom) : undefined, occurredTo: parsed.occurredTo ? new Date(parsed.occurredTo) : undefined };
};

@Controller("admin")
@UseGuards(PermissionsGuard)
@Permissions("admin.manage")
export class AuditActivityController {
  constructor(@Inject(AuditActivityService) private readonly audit: AuditActivityService) {}

  @Get("audit-logs")
  listAudit(@Query() rawQuery: unknown) { return this.audit.listAudit(input(rawQuery)); }

  @Get("users/:userId/activity")
  userActivity(@Param("userId") userId: string, @Query() rawQuery: unknown) { return this.audit.userActivity(id.parse(userId), input(rawQuery)); }
}
