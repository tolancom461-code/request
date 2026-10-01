import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permissions, PermissionsGuard } from "./security.js";
import { RequisitionService } from "./requisition.service.js";
import type { SessionRecord } from "./session.service.js";

type RequestWithSession = FastifyRequest & { restaurantSession?: SessionRecord };
const id = z.string().uuid();
const list = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(48).default(24), search: z.string().trim().max(160).optional() });
const cart = z.object({ branchItemId: id, itemUnitId: id, requestedQuantity: z.union([z.string().regex(/^\d+(\.\d{1,6})?$/), z.number().positive()]), expectedRowVersion: z.number().int().positive().optional() });

@Controller()
export class RequisitionController {
  constructor(@Inject(RequisitionService) private readonly requisitions: RequisitionService) {}
  private user(request: RequestWithSession) { return request.restaurantSession!.userId; }

  @Get("requisition/branches") branches(@Req() request: RequestWithSession) { return this.requisitions.branches(this.user(request)); }
  @Get("requisition/branches/:branchId/categories") categories(@Req() request: RequestWithSession, @Param("branchId") branchId: string) { return this.requisitions.categories(this.user(request), id.parse(branchId)); }
  @Get("requisition/branches/:branchId/items") allItems(@Req() request: RequestWithSession, @Param("branchId") branchId: string, @Query() query: unknown) { return this.requisitions.catalogItems(this.user(request), id.parse(branchId), undefined, list.parse(query)); }
  @Get("requisition/branches/:branchId/categories/:categoryId/items") items(@Req() request: RequestWithSession, @Param("branchId") branchId: string, @Param("categoryId") categoryId: string, @Query() query: unknown) { return this.requisitions.catalogItems(this.user(request), id.parse(branchId), id.parse(categoryId), list.parse(query)); }
  @Get("requisition/branch-items/:branchItemId/units") units(@Req() request: RequestWithSession, @Param("branchItemId") branchItemId: string) { return this.requisitions.units(this.user(request), id.parse(branchItemId)); }

  @Get("requisitions") myRequests(@Req() request: RequestWithSession, @Query() query: unknown) { return this.requisitions.myRequests(this.user(request), list.parse(query)); }
  @Post("requisitions") @UseGuards(PermissionsGuard) @Permissions("request.submit") create(@Req() request: RequestWithSession, @Body() body: unknown) { return this.requisitions.createDraft(this.user(request), id.parse(z.object({ branchId: id }).parse(body).branchId)); }
  @Get("requisitions/:requestId") detail(@Req() request: RequestWithSession, @Param("requestId") requestId: string) { return this.requisitions.requestDetail(this.user(request), id.parse(requestId)); }
  @Post("requisitions/:requestId/items") @UseGuards(PermissionsGuard) @Permissions("request.submit") add(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.requisitions.addOrUpdateLine(this.user(request), id.parse(requestId), cart.parse(body)); }
  @Patch("requisitions/:requestId/items/:requestItemId") @UseGuards(PermissionsGuard) @Permissions("request.submit") edit(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Param("requestItemId") requestItemId: string, @Body() body: unknown) { return this.requisitions.editLine(this.user(request), id.parse(requestId), id.parse(requestItemId), cart.parse(body)); }
  @Delete("requisitions/:requestId/items/:requestItemId") @UseGuards(PermissionsGuard) @Permissions("request.submit") remove(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Param("requestItemId") requestItemId: string, @Query() query: unknown) { return this.requisitions.removeLine(this.user(request), id.parse(requestId), id.parse(requestItemId), z.object({ expectedRowVersion: z.coerce.number().int().positive().optional() }).parse(query).expectedRowVersion); }
  @Post("requisitions/:requestId/returned-items") @UseGuards(PermissionsGuard) @Permissions("request.submit") addReturned(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.requisitions.addReturnedLine(this.user(request), id.parse(requestId), cart.parse(body)); }
  @Post("requisitions/:requestId/submit") @UseGuards(PermissionsGuard) @Permissions("request.submit") submit(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.requisitions.submit(this.user(request), id.parse(requestId), z.object({ expectedRowVersion: z.number().int().positive().optional() }).parse(body).expectedRowVersion); }
  @Post("requisitions/:requestId/resubmit") @UseGuards(PermissionsGuard) @Permissions("request.submit") resubmit(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.requisitions.resubmit(this.user(request), id.parse(requestId), z.object({ expectedRowVersion: z.number().int().positive().optional() }).parse(body).expectedRowVersion); }
}
