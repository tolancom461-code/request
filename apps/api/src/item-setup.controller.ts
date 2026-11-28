import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ItemSetupService, type SetupImage } from "./item-setup.service.js";
import { Permissions } from "./security.js";
import type { SessionRecord } from "./session.service.js";

type RequestWithSession = FastifyRequest & {
  restaurantSession?: SessionRecord;
};
const id = z.string().uuid();
const supplierId = id.transform(value => value.toLowerCase());
const suppliersSchema = z.object({
  supplierIds: z.array(supplierId).min(1).max(5000),
  defaultSupplierId: supplierId,
  expectedSupplierIds: z.array(supplierId).max(5000),
  expectedDefaultSupplierId: supplierId.nullable(),
});
const itemSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().max(120).nullable().optional(),
  categoryId: id,
  nameAr: z.string().trim().min(1).max(250),
  nameEn: z.string().trim().min(1).max(250),
  nameUr: z.string().trim().min(1).max(250),
  baseUnitId: id,
  status: z.enum(["active", "inactive"]).default("active"),
  removeImage: z.boolean().optional(),
});

@Controller("admin/item-setup")
@Permissions("admin.manage")
export class ItemSetupController {
  constructor(
    @Inject(ItemSetupService) private readonly setup: ItemSetupService
  ) {}
  private user(request: RequestWithSession) {
    return request.restaurantSession!.userId;
  }

  @Get("options") options() {
    return this.setup.options();
  }
  @Get("items") items() {
    return this.setup.items();
  }

  private async save(request: RequestWithSession, itemId?: string) {
    let data: unknown;
    let image: SetupImage | undefined;
    if (request.isMultipart()) {
      let dataSeen = false;
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "image" || image)
            throw new BadRequestException("Only one item image is permitted.");
          const bytes = await part.toBuffer();
          if (part.file.truncated)
            throw new BadRequestException("Image exceeds the 5 MiB limit.");
          image = { bytes, contentType: part.mimetype };
        } else if (part.fieldname === "data" && !dataSeen) {
          dataSeen = true;
          try {
            data = JSON.parse(String(part.value));
          } catch {
            throw new BadRequestException("Invalid item data.");
          }
        } else throw new BadRequestException("Unexpected item field.");
      }
    } else data = request.body;
    return this.setup.saveItem(
      this.user(request),
      itemSchema.parse(data),
      image,
      itemId
    );
  }

  @Post("items") create(@Req() request: RequestWithSession) {
    return this.save(request);
  }
  @Patch("items/:itemId") update(
    @Req() request: RequestWithSession,
    @Param("itemId") itemId: string
  ) {
    return this.save(request, id.parse(itemId));
  }
  @Post("items/:itemId/supplier") supplier(
    @Req() request: RequestWithSession,
    @Param("itemId") itemId: string,
    @Body() body: unknown
  ) {
    return this.setup.setSupplier(
      this.user(request),
      id.parse(itemId).toLowerCase(),
      z.object({ supplierId }).parse(body).supplierId
    );
  }
  @Post("items/:itemId/suppliers") suppliers(
    @Req() request: RequestWithSession,
    @Param("itemId") itemId: string,
    @Body() body: unknown
  ) {
    return this.setup.setSuppliers(
      this.user(request),
      id.parse(itemId).toLowerCase(),
      suppliersSchema.parse(body)
    );
  }
  @Post("restaurants/:branchId/items") assign(
    @Req() request: RequestWithSession,
    @Param("branchId") branchId: string,
    @Body() body: unknown
  ) {
    const input = z
      .object({
        itemIds: z.array(id).max(5000),
        expectedItemIds: z.array(id).max(5000),
      })
      .parse(body);
    return this.setup.assignRestaurantItems(
      this.user(request),
      id.parse(branchId),
      input.itemIds,
      input.expectedItemIds
    );
  }
}
