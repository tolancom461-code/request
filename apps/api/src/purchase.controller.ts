import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { PurchaseService } from "./purchase.service.js";
import { Permissions, type AuthenticatedRequest } from "./security.js";

const id = z.string().uuid().transform(value => value.toLowerCase());
const revision = z.number().int().min(0).max(2_147_483_646);
const decimal = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
const plan = z.object({
  expectedRevision: revision,
  basis: z.enum(["last", "average"]),
  allocations: z.array(z.object({ requestItemId: id, supplierId: id, quantity: decimal })).max(5000),
});
const receipt = z.object({
  operationId: id,
  allocationId: id,
  quantity: decimal,
  unitCost: decimal,
  purchasedOn: z.string().date(),
  invoiceReference: z.string().trim().max(160).nullish(),
});
const historyQuery = z.object({ page: z.coerce.number().int().positive().max(100_000).default(1), supplierId: id.optional() });
const openingPurchase = receipt.omit({ allocationId: true }).extend({ supplierId: id, itemUnitId: id });
const openingBatch = z.object({ purchases: z.array(openingPurchase).min(1).max(200) });

@Controller("warehouse/requests/:requestId/purchasing")
@Permissions("warehouse.process")
export class PurchaseController {
  constructor(@Inject(PurchaseService) private readonly purchases: PurchaseService) {}

  @Get()
  detail(@Req() request: AuthenticatedRequest, @Param("requestId") requestId: string) {
    return this.purchases.detail(request.restaurantSession.userId, id.parse(requestId));
  }

  @Post("plan")
  @Permissions("warehouse.process", "purchase.prepare")
  save(@Req() request: AuthenticatedRequest, @Param("requestId") requestId: string, @Body() body: unknown) {
    return this.purchases.save(request.restaurantSession.userId, id.parse(requestId), plan.parse(body));
  }

  @Post("issue")
  @Permissions("warehouse.process", "purchase.issue")
  issue(@Req() request: AuthenticatedRequest, @Param("requestId") requestId: string, @Body() body: unknown) {
    return this.purchases.issue(request.restaurantSession.userId, id.parse(requestId), z.object({ expectedRevision: revision }).parse(body).expectedRevision);
  }

  @Post("receipts")
  @Permissions("warehouse.process", "purchase.record")
  record(@Req() request: AuthenticatedRequest, @Param("requestId") requestId: string, @Body() body: unknown) {
    return this.purchases.record(request.restaurantSession.userId, id.parse(requestId), receipt.parse(body));
  }
}

@Controller("admin/item-setup/items")
@Permissions("admin.manage")
export class PurchaseHistoryController {
  constructor(@Inject(PurchaseService) private readonly purchases: PurchaseService) {}

  @Get(":itemId/purchase-history")
  history(@Param("itemId") itemId: string, @Query() query: unknown) {
    const { page, supplierId } = historyQuery.parse(query);
    return this.purchases.history(id.parse(itemId), page, supplierId);
  }

  @Post(":itemId/purchase-history/opening")
  recordOpening(@Req() request: AuthenticatedRequest, @Param("itemId") itemId: string, @Body() body: unknown) {
    return this.purchases.recordOpening(request.restaurantSession.userId, id.parse(itemId), openingBatch.parse(body).purchases);
  }
}
