import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RequestStatus, type PurchaseCostBasis } from "@prisma/client";
import { DocumentNumberingService, NUMBERING_TIME_ZONE } from "./document-numbering.service.js";
import { PrismaService } from "./prisma.service.js";
import { BranchScopeService, type BranchScope } from "./security.js";

type Tx = Prisma.TransactionClient;
type AllocationInput = { requestItemId: string; supplierId: string; quantity: string };
type PlanInput = { expectedRevision: number; basis: PurchaseCostBasis; allocations: AllocationInput[] };
type ReceiptInput = { operationId: string; allocationId: string; quantity: string; unitCost: string; purchasedOn: string; invoiceReference?: string | null };
type OpeningInput = Omit<ReceiptInput, "allocationId"> & { supplierId: string; itemUnitId: string };
type PurchaseTotals = {
  itemId: string;
  supplierId: string;
  lastPurchasedAt: Date;
  lastAmount: Prisma.Decimal;
  lastBaseQuantity: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  totalBaseQuantity: Prisma.Decimal;
  purchaseCount: bigint;
};
type PurchaseHistoryRow = {
  id: string;
  source: "warehouse" | "opening";
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  unitCode: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  purchasedOn: Date;
  invoiceReference: string | null;
};

const Decimal = Prisma.Decimal.clone({ precision: 80 });
const purchaseDay = new Intl.DateTimeFormat("sv-SE", { timeZone: NUMBERING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const warehouseStatuses: ReadonlySet<RequestStatus> = new Set(["sent_to_warehouse", "preparing", "ready", "dispatched", "completed"]);
const supplierFields = { id: true, supplierCode: true, supplierName: true, status: true, deletedAt: true } satisfies Prisma.SupplierSelect;
const activeLineInclude = {
  itemSnapshot: { include: { supplierLinks: { include: { supplier: { select: supplierFields } } } } },
  itemUnitSnapshot: { include: { unit: true } },
} satisfies Prisma.RequestItemInclude;
type Line = Prisma.RequestItemGetPayload<{ include: typeof activeLineInclude }>;
const costKey = (itemId: string, supplierId: string) => `${itemId}:${supplierId}`;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const sortedIds = (ids: string[]) => [...new Set(ids)].sort();
const supplierChoices = (line: Line) => line.itemSnapshot.supplierLinks.filter(({ supplier }) => supplier.status === "active" && !supplier.deletedAt).map(link => link.supplier);

function prices(row: PurchaseTotals | undefined, factor: Prisma.Decimal | number) {
  return {
    lastCost: row ? new Decimal(row.lastAmount).mul(factor).div(row.lastBaseQuantity).toDecimalPlaces(6).toFixed() : null,
    averageCost: row ? new Decimal(row.totalAmount).mul(factor).div(row.totalBaseQuantity).toDecimalPlaces(6).toFixed() : null,
    lastPurchasedAt: row ? dateOnly(row.lastPurchasedAt) : null,
  };
}

@Injectable()
export class PurchaseService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BranchScopeService) private readonly scopes: BranchScopeService,
    @Inject(DocumentNumberingService) private readonly numbering: DocumentNumberingService,
  ) {}

  private async warehouseRequest(tx: Tx, scope: BranchScope, requestId: string, lock = false) {
    if (lock) await tx.$queryRaw`SELECT id FROM requests WHERE id = ${requestId} FOR UPDATE`;
    const request = await tx.requestRecord.findUnique({ where: { id: requestId }, select: { branchId: true, status: true } });
    if (!request || !warehouseStatuses.has(request.status)) throw new NotFoundException("Warehouse request was not found.");
    if (!scope.isSystemAdmin && !scope.branchIds.includes(request.branchId)) throw new ForbiddenException("The user is not authorized for this branch.");
  }

  private async lines(tx: Tx, requestId: string, lock = false) {
    const where = { requestId, lineStatus: "active" } as const;
    if (lock) {
      const rows = await tx.requestItem.findMany({ where, select: { itemIdSnapshot: true } });
      const itemIds = sortedIds(rows.map(row => row.itemIdSnapshot));
      if (itemIds.length) {
        await tx.$queryRaw`SELECT id FROM items WHERE id IN (${Prisma.join(itemIds)}) ORDER BY id FOR UPDATE`;
      }
    }
    return tx.requestItem.findMany({ where, include: activeLineInclude, orderBy: { id: "asc" } });
  }

  private async totals(tx: Tx, itemIds: string[]) {
    if (!itemIds.length) return new Map<string, PurchaseTotals>();
    const rows = await tx.$queryRaw<PurchaseTotals[]>`
      SELECT item_id AS itemId, supplier_id AS supplierId,
             MAX(CASE WHEN purchase_rank = 1 THEN purchased_on END) AS lastPurchasedAt,
             MAX(CASE WHEN purchase_rank = 1 THEN net_amount END) AS lastAmount,
             MAX(CASE WHEN purchase_rank = 1 THEN base_quantity END) AS lastBaseQuantity,
             SUM(net_amount) AS totalAmount, SUM(base_quantity) AS totalBaseQuantity, COUNT(*) AS purchaseCount
      FROM (
        SELECT item_id, supplier_id, purchased_on, net_amount, base_quantity,
               ROW_NUMBER() OVER (PARTITION BY item_id, supplier_id ORDER BY purchased_on DESC, source_order DESC, created_at DESC, id DESC) AS purchase_rank
        FROM (
          SELECT id, item_id, supplier_id, purchased_on, created_at, net_amount, base_quantity, 1 AS source_order
          FROM purchase_receipts WHERE item_id IN (${Prisma.join(itemIds)})
          UNION ALL
          SELECT id, item_id, supplier_id, purchased_on, created_at, net_amount, base_quantity, 0 AS source_order
          FROM opening_purchases WHERE item_id IN (${Prisma.join(itemIds)})
        ) AS purchases
      ) AS history
      GROUP BY item_id, supplier_id`;
    return new Map(rows.map(row => [costKey(row.itemId, row.supplierId), row]));
  }

  private validateAllocations(lines: Line[], allocations: AllocationInput[], complete: boolean) {
    const linesById = new Map(lines.map(line => [line.id, line]));
    const suppliersByLine = new Map(lines.map(line => [line.id, new Set(supplierChoices(line).map(supplier => supplier.id))]));
    const assigned = new Map<string, Prisma.Decimal>();
    const pairs = new Set<string>();
    const normalized = allocations.map(allocation => {
      const { requestItemId, supplierId } = allocation;
      const line = linesById.get(requestItemId);
      if (!line || !suppliersByLine.get(requestItemId)?.has(supplierId)) throw new BadRequestException("Each allocation must use an active supplier linked to its approved item.");
      const key = costKey(requestItemId, supplierId);
      if (pairs.has(key)) throw new BadRequestException("Enter a single quantity per supplier on each item line.");
      pairs.add(key);
      const quantity = new Decimal(allocation.quantity);
      if (!quantity.gt(0)) throw new BadRequestException("Allocated quantity must be greater than zero.");
      const total = (assigned.get(requestItemId) ?? new Decimal(0)).plus(quantity);
      if (total.gt(line.requestedQuantity)) throw new BadRequestException("Allocated quantity exceeds the approved quantity.");
      assigned.set(requestItemId, total);
      return { requestItemId, supplierId, quantity };
    });

    if (complete && (!lines.length || lines.some(line => !assigned.get(line.id)?.eq(line.requestedQuantity)))) {
      throw new BadRequestException("Allocate the full approved quantity of every item before issuing purchase sheets.");
    }
    return normalized;
  }

  private async view(tx: Tx, requestId: string) {
    const lines = await this.lines(tx, requestId);
    const plan = await tx.purchasePlan.findUnique({
      where: { requestId },
      include: {
        allocations: { orderBy: [{ requestItemId: "asc" }, { supplierId: "asc" }], include: { receipts: { orderBy: [{ purchasedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }] } } },
        sheets: { orderBy: { number: "asc" } },
      },
    });
    const totals = await this.totals(tx, sortedIds(lines.map(line => line.itemIdSnapshot)));
    const viewLines = lines.map(line => {
      const { sku, nameAr, nameEn, nameUr, defaultSupplierId } = line.itemSnapshot;
      const suppliers = supplierChoices(line).map(({ id, supplierCode, supplierName }) => ({ id, code: supplierCode, name: supplierName, ...prices(totals.get(costKey(line.itemIdSnapshot, id)), line.conversionFactorSnapshot) }));
      const defaultId = suppliers.find(supplier => supplier.id === line.supplierIdSnapshot)?.id
        ?? suppliers.find(supplier => supplier.id === defaultSupplierId)?.id ?? null;
      return { id: line.id, sku, nameAr, nameEn, nameUr, unitCode: line.itemUnitSnapshot.unit.code, quantity: line.requestedQuantity.toFixed(), defaultSupplierId: defaultId, suppliers };
    });
    const linesById = new Map(viewLines.map(line => [line.id, line]));
    return {
      requestId,
      plan: plan && { id: plan.id, revision: plan.revision, status: plan.status, basis: plan.basis },
      lines: viewLines,
      allocations: plan?.allocations.map(allocation => {
        const estimate = linesById.get(allocation.requestItemId)?.suppliers.find(supplier => supplier.id === allocation.supplierId);
        return {
          id: allocation.id, requestItemId: allocation.requestItemId, supplierId: allocation.supplierId, quantity: allocation.quantity.toFixed(),
          estimatedUnitCost: plan.status === "issued" ? allocation.estimatedUnitCost?.toFixed() ?? null : (plan.basis === "average" ? estimate?.averageCost : estimate?.lastCost) ?? null,
          purchasedQuantity: allocation.receipts.reduce((sum, row) => sum.plus(row.quantity), new Decimal(0)).toFixed(),
          actualCost: allocation.receipts.reduce((sum, row) => sum.plus(row.netAmount), new Decimal(0)).toFixed(),
        };
      }) ?? [],
      sheets: plan?.sheets.map(({ id, number, supplierId, supplierCode, supplierName, issuedAt }) => ({
        id, number, supplierId, supplierCode, supplierName, issuedAt, allocationIds: plan.allocations.filter(allocation => allocation.sheetId === id).map(allocation => allocation.id),
      })) ?? [],
      purchases: plan?.allocations.flatMap(allocation => allocation.receipts.map(({ id, allocationId, quantity, unitCost, purchasedOn, invoiceReference }) => ({
        id, allocationId, quantity: quantity.toFixed(), unitCost: unitCost.toFixed(), purchasedOn: dateOnly(purchasedOn), invoiceReference,
      }))) ?? [],
    };
  }

  async detail(userId: string, requestId: string) {
    const scope = await this.scopes.scopeFor(userId);
    return this.prisma.$transaction(async tx => {
      await this.warehouseRequest(tx, scope, requestId);
      return this.view(tx, requestId);
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  private async audit(tx: Tx, userId: string, requestId: string, action: string, afterData: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { actorType: "user", actorUserId: userId, entityType: "request", entityId: requestId, action, afterData } });
  }

  async save(userId: string, requestId: string, input: PlanInput) {
    const scope = await this.scopes.scopeFor(userId);
    await this.numbering.transaction(async tx => {
      await this.warehouseRequest(tx, scope, requestId, true);
      const current = await tx.purchasePlan.findUnique({ where: { requestId } });
      if ((current?.revision ?? 0) !== input.expectedRevision || current?.status === "issued") {
        throw new ConflictException("Purchase plan has changed or has been issued. Reload the request.");
      }
      const allocations = this.validateAllocations(await this.lines(tx, requestId, true), input.allocations, false);
      const plan = current
        ? await tx.purchasePlan.update({ where: { id: current.id }, data: { basis: input.basis, revision: { increment: 1 } } })
        : await tx.purchasePlan.create({ data: { requestId, basis: input.basis, createdByUserId: userId } });
      if (current) await tx.purchaseAllocation.deleteMany({ where: { planId: plan.id } });
      if (allocations.length) await tx.purchaseAllocation.createMany({ data: allocations.map(allocation => ({ ...allocation, planId: plan.id })) });
      await this.audit(tx, userId, requestId, "purchase.plan_saved", { planId: plan.id, revision: plan.revision, basis: input.basis, allocations: input.allocations });
    }, Prisma.TransactionIsolationLevel.ReadCommitted);
    return this.detail(userId, requestId);
  }

  async issue(userId: string, requestId: string, expectedRevision: number) {
    const scope = await this.scopes.scopeFor(userId);
    await this.numbering.transaction(async tx => {
      await this.warehouseRequest(tx, scope, requestId, true);
      const plan = await tx.purchasePlan.findUnique({ where: { requestId }, include: { allocations: { include: { supplier: { select: supplierFields } } } } });
      if (!plan) throw new BadRequestException("Save a purchase plan before issuing purchase sheets.");
      if (plan.status === "issued" && plan.revision === expectedRevision + 1) return;
      if (plan.status !== "draft" || plan.revision !== expectedRevision) throw new ConflictException("Purchase plan has changed. Reload the request.");

      const lines = await this.lines(tx, requestId, true);
      this.validateAllocations(lines, plan.allocations.map(allocation => ({ ...allocation, quantity: allocation.quantity.toFixed() })), true);
      const linesById = new Map(lines.map(line => [line.id, line]));
      const totals = await this.totals(tx, sortedIds(lines.map(line => line.itemIdSnapshot)));
      const issuedAt = new Date();
      const bySupplier = new Map<string, typeof plan.allocations>();
      for (const allocation of plan.allocations) {
        const supplierAllocations = bySupplier.get(allocation.supplierId);
        if (supplierAllocations) supplierAllocations.push(allocation);
        else bySupplier.set(allocation.supplierId, [allocation]);
      }
      const sheetNumbers: string[] = [];
      for (const supplierId of sortedIds([...bySupplier.keys()])) {
        const allocations = bySupplier.get(supplierId)!;
        const supplier = allocations[0]!.supplier;
        const number = await this.numbering.next(tx, "purchase", issuedAt);
        const sheet = await tx.purchaseSheet.create({ data: { planId: plan.id, supplierId, number, supplierCode: supplier.supplierCode, supplierName: supplier.supplierName, issuedAt } });
        sheetNumbers.push(sheet.number);
        const estimates = allocations.map(allocation => {
          const line = linesById.get(allocation.requestItemId)!;
          const { lastCost, averageCost } = prices(totals.get(costKey(line.itemIdSnapshot, supplierId)), line.conversionFactorSnapshot);
          return Prisma.sql`WHEN ${allocation.id} THEN ${plan.basis === "average" ? averageCost : lastCost}`;
        });
        await tx.$executeRaw`UPDATE purchase_allocations
          SET sheet_id = ${sheet.id}, estimated_unit_cost = CASE id ${Prisma.join(estimates, " ")} END
          WHERE id IN (${Prisma.join(allocations.map(allocation => allocation.id))})`;
      }
      await tx.purchasePlan.update({ where: { id: plan.id }, data: { status: "issued", revision: { increment: 1 }, issuedAt, issuedByUserId: userId } });
      await this.audit(tx, userId, requestId, "purchase.sheets_issued", { planId: plan.id, sheetNumbers });
    }, Prisma.TransactionIsolationLevel.ReadCommitted);
    return this.detail(userId, requestId);
  }

  async record(userId: string, requestId: string, input: ReceiptInput) {
    const scope = await this.scopes.scopeFor(userId);
    const quantity = new Decimal(input.quantity);
    const unitCost = new Decimal(input.unitCost);
    if (!quantity.gt(0)) throw new BadRequestException("Purchased quantity must be greater than zero.");
    const purchasedOn = new Date(`${input.purchasedOn}T00:00:00.000Z`);
    const invoiceReference = input.invoiceReference?.trim() || null;
    try {
      await this.numbering.transaction(async tx => {
        await this.warehouseRequest(tx, scope, requestId, true);
        const allocation = await tx.purchaseAllocation.findFirst({
          where: { id: input.allocationId, sheetId: { not: null }, plan: { requestId, status: "issued" } }, include: { requestItem: true },
        });
        if (!allocation) throw new BadRequestException("Purchases can only be recorded for an issued allocation on this request.");
        const existing = await tx.purchaseReceipt.findUnique({ where: { operationId: input.operationId } });
        if (existing) {
          if (existing.allocationId === allocation.id && existing.quantity.eq(quantity) && existing.unitCost.eq(unitCost)
              && dateOnly(existing.purchasedOn) === input.purchasedOn && existing.invoiceReference === invoiceReference) return;
          throw new ConflictException("The purchase recording reference is already in use.");
        }
        const { _sum } = await tx.purchaseReceipt.aggregate({ where: { allocationId: allocation.id }, _sum: { quantity: true } });
        if (quantity.plus(_sum.quantity ?? 0).gt(allocation.quantity)) throw new ConflictException({ code: "PURCHASE_QUANTITY_EXCEEDED", message: "Purchased quantity exceeds the remaining allocation." });
        const { itemIdSnapshot: itemId, conversionFactorSnapshot } = allocation.requestItem;
        const receipt = await tx.purchaseReceipt.create({ data: {
          operationId: input.operationId, allocationId: allocation.id, itemId, supplierId: allocation.supplierId,
          quantity, unitCost, baseQuantity: quantity.mul(conversionFactorSnapshot), netAmount: quantity.mul(unitCost), purchasedOn, invoiceReference, recordedByUserId: userId,
        } });
        await this.audit(tx, userId, requestId, "purchase.receipt_recorded", { receiptId: receipt.id, allocationId: allocation.id, quantity: quantity.toFixed(), unitCost: unitCost.toFixed(), purchasedOn: input.purchasedOn, invoiceReference });
      }, Prisma.TransactionIsolationLevel.ReadCommitted);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("The purchase recording reference is already in use.");
      throw error;
    }
    return this.detail(userId, requestId);
  }

  async history(itemId: string, page: number, supplierId?: string) {
    const pageSize = 20;
    return this.prisma.$transaction(async tx => {
      const item = await tx.item.findUnique({ where: { id: itemId }, select: {
        itemUnits: { orderBy: [{ isBaseUnit: "desc" }, { unit: { code: "asc" } }], include: { unit: { select: { code: true } } } },
        supplierLinks: { select: { supplierId: true } },
      } });
      if (!item) throw new NotFoundException("Item was not found.");
      const totals = await this.totals(tx, [itemId]);
      const historySuppliers = new Set([...item.supplierLinks.map(link => link.supplierId), ...[...totals.values()].map(row => row.supplierId)]);
      const openingSuppliers = (await tx.supplier.findMany({ select: supplierFields, orderBy: { supplierCode: "asc" } }))
        .map(({ id, supplierCode, supplierName }) => ({ id, code: supplierCode, name: supplierName }));
      const total = [...totals.values()]
        .filter(row => !supplierId || row.supplierId === supplierId)
        .reduce((count, row) => count + Number(row.purchaseCount), 0);
      const filter = Prisma.sql`receipt.item_id = ${itemId} ${supplierId ? Prisma.sql`AND receipt.supplier_id = ${supplierId}` : Prisma.empty}`;
      const purchases = total ? await tx.$queryRaw<PurchaseHistoryRow[]>`
        SELECT id, source, supplierId, supplierCode, supplierName, unitCode, quantity, unitCost, purchasedOn, invoiceReference
        FROM (
          SELECT receipt.id, 'warehouse' AS source, 1 AS sourceOrder,
                 receipt.supplier_id AS supplierId, COALESCE(sheet.supplier_code, supplier.supplier_code) AS supplierCode,
                 COALESCE(sheet.supplier_name, supplier.supplier_name) AS supplierName, unit.code AS unitCode,
                 receipt.quantity, receipt.unit_cost AS unitCost, receipt.purchased_on AS purchasedOn,
                 receipt.invoice_reference AS invoiceReference, receipt.created_at AS createdAt
          FROM purchase_receipts AS receipt
          JOIN purchase_allocations AS allocation ON allocation.id = receipt.allocation_id
          JOIN request_items AS request_item ON request_item.id = allocation.request_item_id
          JOIN item_units AS item_unit ON item_unit.id = request_item.item_unit_id_snapshot
          JOIN units AS unit ON unit.id = item_unit.unit_id
          JOIN suppliers AS supplier ON supplier.id = receipt.supplier_id
          LEFT JOIN purchase_sheets AS sheet ON sheet.id = allocation.sheet_id
          WHERE ${filter}
          UNION ALL
          SELECT receipt.id, 'opening' AS source, 0 AS sourceOrder, receipt.supplier_id AS supplierId,
                 receipt.supplier_code AS supplierCode, receipt.supplier_name AS supplierName, receipt.unit_code AS unitCode,
                 receipt.quantity, receipt.unit_cost AS unitCost, receipt.purchased_on AS purchasedOn,
                 receipt.invoice_reference AS invoiceReference, receipt.created_at AS createdAt
          FROM opening_purchases AS receipt WHERE ${filter}
        ) AS purchases
        ORDER BY purchasedOn DESC, sourceOrder DESC, createdAt DESC, id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : [];
      const base = item.itemUnits.find(unit => unit.isBaseUnit);
      return {
        unitCode: base?.unit.code ?? "", page, pageSize, total, openingSuppliers,
        units: base?.activeBaseItemId === itemId && base.status === "active" && base.conversionFactorToBase.eq(1)
          ? item.itemUnits.filter(unit => unit.conversionFactorToBase.gt(0)).map(unit => ({
          id: unit.id, code: unit.unit.code, conversionFactor: unit.conversionFactorToBase.toFixed(),
        })) : [],
        suppliers: openingSuppliers.filter(supplier => historySuppliers.has(supplier.id)).map(supplier => ({
          ...supplier, ...prices(totals.get(costKey(itemId, supplier.id)), 1),
        })),
        purchases: purchases.map(({ quantity, unitCost, purchasedOn, ...purchase }) => ({
          ...purchase, quantity: quantity.toFixed(), unitCost: unitCost.toFixed(), purchasedOn: dateOnly(purchasedOn),
        })),
      };
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  async recordOpening(userId: string, itemId: string, input: OpeningInput[]) {
    const operationIds = sortedIds(input.map(row => row.operationId));
    if (operationIds.length !== input.length) throw new BadRequestException("Opening purchases must have distinct recording references.");
    const today = purchaseDay.format(new Date());
    const rows = input.map((row, index) => {
      const quantity = new Decimal(row.quantity);
      if (!quantity.gt(0)) throw new BadRequestException(`Row ${index + 1}: purchased quantity must be greater than zero.`);
      if (row.purchasedOn < "1000-01-01" || row.purchasedOn > today) throw new BadRequestException(`Row ${index + 1}: enter a valid purchase date through today.`);
      return { ...row, index, quantity, unitCost: new Decimal(row.unitCost), invoiceReference: row.invoiceReference?.trim() || null };
    });

    try {
      return await this.numbering.transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM items WHERE id = ${itemId} FOR UPDATE`;
        const item = await tx.item.findUnique({ where: { id: itemId }, select: { id: true } });
        if (!item) throw new NotFoundException("Item was not found.");
        const existing = new Map((await tx.openingPurchase.findMany({ where: { operationId: { in: operationIds } } })).map(row => [row.operationId, row]));
        const pending = rows.filter(row => {
          const previous = existing.get(row.operationId);
          if (!previous) return true;
          if (previous.itemId !== itemId || previous.supplierId !== row.supplierId || previous.itemUnitId !== row.itemUnitId
            || !previous.quantity.eq(row.quantity) || !previous.unitCost.eq(row.unitCost) || dateOnly(previous.purchasedOn) !== row.purchasedOn
            || previous.invoiceReference !== row.invoiceReference) throw new ConflictException("The opening purchase reference is already in use.");
          return false;
        });
        if (!pending.length) return { saved: 0 };

        const units = await tx.itemUnit.findMany({ where: { itemId }, include: { unit: { select: { code: true } } } });
        const base = units.find(unit => unit.activeBaseItemId === itemId && unit.isBaseUnit && unit.status === "active" && unit.conversionFactorToBase.eq(1));
        if (!base) throw new BadRequestException("Configure the item's base unit before importing opening purchases.");
        const byUnit = new Map(units.map(unit => [unit.id, unit]));
        const suppliers = await tx.supplier.findMany({ where: { id: { in: sortedIds(pending.map(row => row.supplierId)) } }, select: supplierFields });
        const bySupplier = new Map(suppliers.map(supplier => [supplier.id, supplier]));
        const data = pending.map(row => {
          const supplier = bySupplier.get(row.supplierId);
          if (!supplier) throw new BadRequestException(`Row ${row.index + 1}: supplier was not found.`);
          const unit = byUnit.get(row.itemUnitId);
          if (!unit?.conversionFactorToBase.gt(0)) throw new BadRequestException(`Row ${row.index + 1}: choose a valid unit for this item.`);
          return {
            operationId: row.operationId, itemId, supplierId: supplier.id, itemUnitId: unit.id,
            supplierCode: supplier.supplierCode, supplierName: supplier.supplierName, unitCode: unit.unit.code,
            quantity: row.quantity, baseQuantity: row.quantity.mul(unit.conversionFactorToBase), unitCost: row.unitCost, netAmount: row.quantity.mul(row.unitCost),
            purchasedOn: new Date(`${row.purchasedOn}T00:00:00.000Z`), invoiceReference: row.invoiceReference, recordedByUserId: userId,
          };
        });
        const { count } = await tx.openingPurchase.createMany({ data });
        await tx.auditLog.create({ data: {
          actorType: "user", actorUserId: userId, entityType: "item", entityId: itemId, action: "purchase.opening_recorded",
          afterData: { count, operationIds: pending.map(row => row.operationId) },
        } });
        return { saved: count };
      }, Prisma.TransactionIsolationLevel.ReadCommitted);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("The opening purchase reference is already in use.");
      throw error;
    }
  }
}
