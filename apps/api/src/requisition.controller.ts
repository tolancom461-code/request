import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permissions } from "./security.js";
import { RequisitionService } from "./requisition.service.js";
import type { SessionRecord } from "./session.service.js";

type RequestWithSession = FastifyRequest & { restaurantSession?: SessionRecord };
const id = z.string().uuid();
const list = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(48).default(24), search: z.string().trim().max(160).optional() });
const cart = z.object({ branchItemId: id, itemUnitId: id, requestedQuantity: z.union([z.string().regex(/^\d+(\.\d{1,6})?$/), z.number().positive()]), expectedRowVersion: z.number().int().positive().optional() });

@Controller()
@Permissions("request.submit")
export class RequisitionController {
  constructor(@Inject(RequisitionService) private readonly requisitions: RequisitionService) {}
  private user(request: RequestWithSession) { return request.restaurantSession!.userId; }

  @Get("requisition/branches")
  @Permissions("branch.read")
  branches(@Req() request: RequestWithSession) { return this.requisitions.branches(this.user(request)); }

  @Get("requisition/branches/:branchId/categories")
  @Permissions("branch.read")
  categories(@Req() request: RequestWithSession, @Param("branchId") branchId: string) { return this.requisitions.categories(this.user(request), id.parse(branchId)); }

  @Get("requisition/branches/:branchId/items")
  @Permissions("branch.read")
  allItems(@Req() request: RequestWithSession, @Param("branchId") branchId: string, @Query() query: unknown) { return this.requisitions.catalogItems(this.user(request), id.parse(branchId), undefined, list.parse(query)); }

  @Get("requisition/branches/:branchId/categories/:categoryId/items")
  @Permissions("branch.read")
  items(@Req() request: RequestWithSession, @Param("branchId") branchId: string, @Param("categoryId") categoryId: string, @Query() query: unknown) { return this.requisitions.catalogItems(this.user(request), id.parse(branchId), id.parse(categoryId), list.parse(query)); }

  @Get("requisition/branch-items/:branchItemId/units")
  @Permissions("branch.read")
  units(@Req() request: RequestWithSession, @Param("branchItemId") branchItemId: string) { return this.requisitions.units(this.user(request), id.parse(branchItemId)); }

  @Get("requisitions") myRequests(@Req() request: RequestWithSession, @Query() query: unknown) { return this.requisitions.myRequests(this.user(request), list.parse(query)); }
  @Post("requisitions") create(@Req() request: RequestWithSession, @Body() body: unknown) { return this.requisitions.createDraft(this.user(request), id.parse(z.object({ branchId: id }).parse(body).branchId)); }
  @Get("requisitions/:requestId") detail(@Req() request: RequestWithSession, @Param("requestId") requestId: string) { return this.requisitions.requestDetail(this.user(request), id.parse(requestId)); }
  @Post("requisitions/:requestId/items") add(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.requisitions.addOrUpdateLine(this.user(request), id.parse(requestId), cart.parse(body)); }
  @Patch("requisitions/:requestId/items/:requestItemId") edit(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Param("requestItemId") requestItemId: string, @Body() body: unknown) { return this.requisitions.editLine(this.user(request), id.parse(requestId), id.parse(requestItemId), cart.parse(body)); }
  @Delete("requisitions/:requestId/items/:requestItemId") remove(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Param("requestItemId") requestItemId: string, @Query() query: unknown) { return this.requisitions.removeLine(this.user(request), id.parse(requestId), id.parse(requestItemId), z.object({ expectedRowVersion: z.coerce.number().int().positive().optional() }).parse(query).expectedRowVersion); }
  @Post("requisitions/:requestId/returned-items") addReturned(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.requisitions.addReturnedLine(this.user(request), id.parse(requestId), cart.parse(body)); }
  @Post("requisitions/:requestId/submit") submit(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.requisitions.submit(this.user(request), id.parse(requestId), z.object({ expectedRowVersion: z.number().int().positive().optional() }).parse(body).expectedRowVersion); }
  @Post("requisitions/:requestId/resubmit") resubmit(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.requisitions.resubmit(this.user(request), id.parse(requestId), z.object({ expectedRowVersion: z.number().int().positive().optional() }).parse(body).expectedRowVersion); }
}
