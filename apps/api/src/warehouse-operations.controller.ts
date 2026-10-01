import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permissions, PermissionsGuard } from "./security.js";
import type { SessionRecord } from "./session.service.js";
import { WarehouseOperationsService, type WarehouseListInput } from "./warehouse-operations.service.js";

type RequestWithSession = FastifyRequest & { restaurantSession?: SessionRecord };
const id = z.string().uuid();
const warehouseStatus = z.enum(["sent_to_warehouse", "preparing", "ready", "dispatched", "completed"]);
const list = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  search: z.string().trim().max(160).optional(),
  branchId: id.optional(),
  supplierId: id.optional(),
  itemId: id.optional(),
  status: z.union([z.string(), z.array(z.string())]).optional(),
  warehouseFrom: z.string().datetime().optional(),
  warehouseTo: z.string().datetime().optional(),
  submittedFrom: z.string().datetime().optional(),
  submittedTo: z.string().datetime().optional(),
  updatedFrom: z.string().datetime().optional(),
  updatedTo: z.string().datetime().optional(),
  sort: z.enum(["warehouseAvailableAt", "submittedAt", "updatedAt", "requestNumber"]).default("warehouseAvailableAt"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
const groupBy = z.enum(["request", "branch", "supplier", "item"]);
const transition = z.object({ expectedRowVersion: z.number().int().positive() });

const toInput = (query: unknown): WarehouseListInput => {
  const parsed = list.parse(query);
  const rawStatuses = parsed.status ? (Array.isArray(parsed.status) ? parsed.status : [parsed.status]).flatMap((value) => value.split(",")).filter(Boolean) : undefined;
  return {
    ...parsed,
    statuses: rawStatuses?.map((value) => warehouseStatus.parse(value.trim())),
    warehouseFrom: parsed.warehouseFrom ? new Date(parsed.warehouseFrom) : undefined,
    warehouseTo: parsed.warehouseTo ? new Date(parsed.warehouseTo) : undefined,
    submittedFrom: parsed.submittedFrom ? new Date(parsed.submittedFrom) : undefined,
    submittedTo: parsed.submittedTo ? new Date(parsed.submittedTo) : undefined,
    updatedFrom: parsed.updatedFrom ? new Date(parsed.updatedFrom) : undefined,
    updatedTo: parsed.updatedTo ? new Date(parsed.updatedTo) : undefined,
  };
};

@Controller("warehouse/requests")
export class WarehouseOperationsController {
  constructor(@Inject(WarehouseOperationsService) private readonly warehouse: WarehouseOperationsService) {}
  private user(request: RequestWithSession) { return request.restaurantSession!.userId; }

  @Get()
  @UseGuards(PermissionsGuard)
  @Permissions("warehouse.process")
  list(@Req() request: RequestWithSession, @Query() query: unknown) { return this.warehouse.list(this.user(request), toInput(query)); }

  @Get("groups")
  @UseGuards(PermissionsGuard)
  @Permissions("warehouse.process")
  groups(@Req() request: RequestWithSession, @Query() query: unknown) {
    const input = toInput(query);
    const rawGroupBy = (query as Record<string, unknown>).groupBy;
    return this.warehouse.groups(this.user(request), input, groupBy.parse(rawGroupBy ?? "request"));
  }

  @Get(":requestId")
  @UseGuards(PermissionsGuard)
  @Permissions("warehouse.process")
  detail(@Req() request: RequestWithSession, @Param("requestId") requestId: string) { return this.warehouse.detail(this.user(request), id.parse(requestId)); }

  @Post(":requestId/start-preparation")
  @UseGuards(PermissionsGuard)
  @Permissions("warehouse.process")
  startPreparation(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.warehouse.startPreparation(this.user(request), id.parse(requestId), transition.parse(body).expectedRowVersion); }

  @Post(":requestId/mark-ready")
  @UseGuards(PermissionsGuard)
  @Permissions("warehouse.process")
  markReady(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.warehouse.markReady(this.user(request), id.parse(requestId), transition.parse(body).expectedRowVersion); }

  @Post(":requestId/dispatch")
  @UseGuards(PermissionsGuard)
  @Permissions("warehouse.process")
  dispatch(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.warehouse.dispatch(this.user(request), id.parse(requestId), transition.parse(body).expectedRowVersion); }

  @Post(":requestId/complete")
  @UseGuards(PermissionsGuard)
  @Permissions("warehouse.process")
  complete(@Req() request: RequestWithSession, @Param("requestId") requestId: string, @Body() body: unknown) { return this.warehouse.complete(this.user(request), id.parse(requestId), transition.parse(body).expectedRowVersion); }
}
