import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { RecordStatus } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ItemsService, type ItemListQuery } from "./items.service.js";
import { Permissions, PermissionsGuard } from "./security.js";
import type { SessionRecord } from "./session.service.js";

type RequestWithSession = FastifyRequest & { restaurantSession?: SessionRecord };
const id = z.string().uuid();
const status = z.nativeEnum(RecordStatus);
const itemSchema = z.object({ sku: z.string().trim().min(1).max(80), barcode: z.string().trim().min(1).max(120).nullable().optional(), categoryId: id, nameAr: z.string().trim().min(1).max(250), nameEn: z.string().trim().min(1).max(250).nullable().optional(), nameUr: z.string().trim().min(1).max(250).nullable().optional(), status: status.optional() });
const unitSchema = z.object({ unitId: id, conversionFactorToBase: z.string().regex(/^\d+(?:\.\d{1,6})?$/), isBaseUnit: z.boolean().optional(), status: status.optional() });
const unitPatchSchema = unitSchema.omit({ unitId: true }).partial().refine((value) => Object.keys(value).length > 0, "At least one field is required.");
const branchSchema = z.object({ branchId: id, status: status.optional() });
const supplierSchema = z.object({ supplierId: id, isPrimary: z.boolean().optional(), status: status.optional(), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });
const querySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().min(1).max(120).optional(), status: status.optional(), categoryId: id.optional(), sortBy: z.string().trim().min(1).max(40).default("sku"), sortDir: z.enum(["asc", "desc"]).default("asc") });
const patch = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

@Controller("admin/items")
@UseGuards(PermissionsGuard)
@Permissions("admin.manage")
export class ItemsController {
  constructor(@Inject(ItemsService) private readonly items: ItemsService) {}
  private actor(request: RequestWithSession) { return request.restaurantSession!.userId; }
  private id(raw: string) { return id.parse(raw); }
  @Get() list(@Query() query: unknown) { return this.items.list(querySchema.parse(query) as ItemListQuery); }
  @Post() create(@Body() body: unknown, @Req() request: RequestWithSession) { return this.items.create(itemSchema.parse(body), this.actor(request)); }
  @Get(":id") get(@Param("id") rawId: string) { return this.items.get(this.id(rawId)); }
  @Patch(":id") update(@Param("id") rawId: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.items.update(this.id(rawId), patch(itemSchema.shape).parse(body), this.actor(request)); }
  @Post(":id/status") setStatus(@Param("id") rawId: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.items.setStatus(this.id(rawId), z.object({ status }).parse(body).status, this.actor(request)); }
  @Get(":id/image") image(@Param("id") rawId: string) { return this.items.imageUrl(this.id(rawId)); }
  @Post(":id/image") async uploadImage(@Param("id") rawId: string, @Req() request: RequestWithSession) {
    const file = await request.file();
    if (!file) throw new BadRequestException("An image file is required.");
    const bytes = await file.toBuffer();
    if (file.file.truncated) throw new BadRequestException("Image exceeds the 5 MiB limit.");
    return this.items.replaceImage(this.id(rawId), bytes, file.mimetype, bytes.byteLength, this.actor(request));
  }
  @Delete(":id/image") removeImage(@Param("id") rawId: string, @Req() request: RequestWithSession) { return this.items.removeImage(this.id(rawId), this.actor(request)); }
  @Get(":id/units") units(@Param("id") rawId: string) { return this.items.listUnits(this.id(rawId)); }
  @Post(":id/units") addUnit(@Param("id") rawId: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.items.addUnit(this.id(rawId), unitSchema.parse(body), this.actor(request)); }
  @Patch(":id/units/:itemUnitId") updateUnit(@Param("id") rawId: string, @Param("itemUnitId") rawItemUnitId: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.items.updateUnit(this.id(rawId), this.id(rawItemUnitId), unitPatchSchema.parse(body), this.actor(request)); }
  @Get(":id/branches") branches(@Param("id") rawId: string) { return this.items.listBranches(this.id(rawId)); }
  @Post(":id/branches") assignBranch(@Param("id") rawId: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.items.assignBranch(this.id(rawId), branchSchema.parse(body), this.actor(request)); }
  @Post(":id/branches/:branchItemId/status") branchStatus(@Param("id") rawId: string, @Param("branchItemId") rawBranchItemId: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.items.setBranchStatus(this.id(rawId), this.id(rawBranchItemId), z.object({ status }).parse(body).status, this.actor(request)); }
}

@Controller("admin/branch-items")
@UseGuards(PermissionsGuard)
@Permissions("admin.manage")
export class BranchItemSuppliersController {
  constructor(@Inject(ItemsService) private readonly items: ItemsService) {}
  private actor(request: RequestWithSession) { return request.restaurantSession!.userId; }
  private id(raw: string) { return id.parse(raw); }
  @Get(":branchItemId/suppliers") suppliers(@Param("branchItemId") rawBranchItemId: string) { return this.items.listSuppliers(this.id(rawBranchItemId)); }
  @Post(":branchItemId/suppliers") upsertSupplier(@Param("branchItemId") rawBranchItemId: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.items.upsertSupplier(this.id(rawBranchItemId), supplierSchema.parse(body), this.actor(request)); }
  @Post(":branchItemId/suppliers/:supplierRelationId/status") supplierStatus(@Param("branchItemId") rawBranchItemId: string, @Param("supplierRelationId") rawSupplierRelationId: string, @Body() body: unknown, @Req() request: RequestWithSession) { return this.items.setSupplierStatus(this.id(rawBranchItemId), this.id(rawSupplierRelationId), z.object({ status }).parse(body).status, this.actor(request)); }
}
