import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ManagerApprovalService } from "./manager-approval.service.js";
import { Permissions, PermissionsGuard } from "./security.js";
import type { SessionRecord } from "./session.service.js";

type RequestWithSession = FastifyRequest & { restaurantSession?: SessionRecord };
const id = z.string().uuid();
const list = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  search: z.string().trim().max(160).optional(),
  branchId: id.optional(),
  submittedFrom: z.string().datetime().optional(),
  submittedTo: z.string().datetime().optional(),
  sort: z.enum(["submittedAt", "requestNumber", "updatedAt"]).default("submittedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
const line = z.object({ itemUnitId: id, requestedQuantity: z.union([z.string().regex(/^\d+(\.\d{1,6})?$/), z.number().positive()]), expectedRowVersion: z.number().int().positive() });
const decision = z.object({ expectedRowVersion: z.number().int().positive(), comment: z.string().trim().max(1000).optional() });
const reason = z.object({ expectedRowVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(1000) });

@Controller("manager/requests")
export class ManagerApprovalController {
  constructor(@Inject(ManagerApprovalService) private readonly manager: ManagerApprovalService) {}
  private user(request: RequestWithSession) { return request.restaurantSession!.userId; }

  @Get()
  @UseGuards(PermissionsGuard)
  @Permissions("request.review")
  list(@Req() request: RequestWithSession, @Query() query: unknown) {
    const input = list.parse(query);
    return this.manager.listPending(this.user(request), { ...input, submittedFrom: input.submittedFrom ? new Date(input.submittedFrom) : undefined, submittedTo: input.submittedTo ? new Date(input.submittedTo) : undefined });
  }

  @Get(":requestId")
  @UseGuards(PermissionsGuard)
  @Permissions("request.review")
  detail(@Req() request: RequestWithSession, @Param("requestId") requestId: string) { return this.manager.detail(this.user(request), id.parse(requestId)); }

  @Get(":requestId/items/:requestItemId/units")
  @UseGuards(PermissionsGuard)
  @Permissions("request.review")
  lineUnits(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Param("requestItemId") requestItemId: string) { return this.manager.lineUnits(this.user(request), id.parse(requestId), id.parse(requestItemId)); }

  @Patch(":requestId/items/:requestItemId")
  @UseGuards(PermissionsGuard)
  @Permissions("request.review")
  updateLine(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Param("requestItemId") requestItemId: string, @Body() body: unknown) { return this.manager.updatePendingLine(this.user(request), id.parse(requestId), id.parse(requestItemId), line.parse(body)); }

  @Post(":requestId/items/:requestItemId/exclude")
  @UseGuards(PermissionsGuard)
  @Permissions("request.review")
  excludeLine(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Param("requestItemId") requestItemId: string, @Body() body: unknown) { return this.manager.excludePendingLine(this.user(request), id.parse(requestId), id.parse(requestItemId), reason.parse(body)); }

  @Post(":requestId/approve")
  @UseGuards(PermissionsGuard)
  @Permissions("request.approve")
  approve(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.manager.approve(this.user(request), id.parse(requestId), decision.parse(body)); }

  @Post(":requestId/return")
  @UseGuards(PermissionsGuard)
  @Permissions("request.return")
  returnRequest(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.manager.returnRequest(this.user(request), id.parse(requestId), reason.parse(body)); }

  @Post(":requestId/reject")
  @UseGuards(PermissionsGuard)
  @Permissions("request.reject")
  reject(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.manager.reject(this.user(request), id.parse(requestId), reason.parse(body)); }
}
