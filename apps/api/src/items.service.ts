import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, Prisma, RecordStatus } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";
import { PrimarySupplierTemporalService } from "./primary-supplier-temporal.service.js";
import { StorageService } from "./storage.service.js";

export type ItemListQuery = { page: number; pageSize: number; search?: string; status?: RecordStatus; categoryId?: string; sortBy: string; sortDir: "asc" | "desc" };
export type ItemInput = { sku: string; barcode?: string | null; categoryId: string; nameAr: string; nameEn?: string | null; nameUr?: string | null; status?: RecordStatus };
export type ItemUnitInput = { unitId: string; conversionFactorToBase: string; isBaseUnit?: boolean; status?: RecordStatus };
export type BranchItemInput = { branchId: string; status?: RecordStatus };
export type SupplierInput = { supplierId: string; isPrimary?: boolean; status?: RecordStatus; effectiveFrom: string; effectiveTo?: string | null };

const txOptions = { maxWait: 10_000, timeout: 60_000 };
const asJson = (value: unknown) => value as Prisma.InputJsonValue;
const clean = (value: string | null | undefined) => value == null || value.trim() === "" ? null : value.trim();

@Injectable()
export class ItemsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(StorageService) private readonly storage: StorageService, @Inject(PrimarySupplierTemporalService) private readonly primaries: PrimarySupplierTemporalService) {}

  private duplicate(error: unknown, label: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException(`${label} must be unique or already assigned.`);
    throw error;
  }

  private async audit(tx: Prisma.TransactionClient, actorUserId: string, entityType: string, entityId: string, action: string, beforeData?: unknown, afterData?: unknown) {
    await tx.auditLog.create({ data: { actorType: ActorType.user, actorUserId, entityType, entityId, action, beforeData: beforeData == null ? undefined : asJson(beforeData), afterData: afterData == null ? undefined : asJson(afterData) } });
  }

  private normalizeItem(input: Partial<ItemInput>) {
    return { ...input, ...(input.barcode !== undefined ? { barcode: clean(input.barcode) } : {}), ...(input.nameEn !== undefined ? { nameEn: clean(input.nameEn) } : {}), ...(input.nameUr !== undefined ? { nameUr: clean(input.nameUr) } : {}) };
  }

  private async category(tx: Prisma.TransactionClient, categoryId: string, mustBeActive = true) {
    const category = await tx.category.findUnique({ where: { id: categoryId } });
    if (!category || (mustBeActive && (category.status !== RecordStatus.active || category.deletedAt))) throw new BadRequestException("Category is not available for an operational item.");
    return category;
  }

  private async item(tx: Prisma.TransactionClient, itemId: string) {
    const item = await tx.item.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException("Item was not found.");
    return item;
  }

  private activeBaseWhere(itemId: string): Prisma.ItemUnitWhereInput {
    return { itemId, status: RecordStatus.active, isBaseUnit: true, activeBaseItemId: itemId, conversionFactorToBase: new Prisma.Decimal(1) };
  }

  private async assertOperationalBase(tx: Prisma.TransactionClient, itemId: string) {
    const count = await tx.itemUnit.count({ where: this.activeBaseWhere(itemId) });
    if (count !== 1) throw new BadRequestException("An active item must have exactly one active base unit with factor 1.");
  }

  private date(value: string, label: string) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf()) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${label} must be a valid ISO date.`);
    return parsed;
  }

  private itemView(item: Awaited<ReturnType<typeof this.prisma.item.findUnique>> & {}) { return item; }

  async list(query: ItemListQuery) {
    const where: Prisma.ItemWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search ? { OR: [{ sku: { contains: query.search } }, { barcode: { contains: query.search } }, { nameAr: { contains: query.search } }, { nameEn: { contains: query.search } }, { nameUr: { contains: query.search } }] } : {}),
    };
    const sortBy = new Set(["sku", "barcode", "nameAr", "nameEn", "nameUr", "status"]).has(query.sortBy) ? query.sortBy : "sku";
    const [total, items] = await this.prisma.$transaction([
      this.prisma.item.count({ where }),
      this.prisma.item.findMany({ where, include: { category: { select: { id: true, code: true, nameAr: true, nameEn: true, status: true } }, itemUnits: { where: { status: RecordStatus.active }, select: { id: true, isBaseUnit: true, activeBaseItemId: true } }, branchItems: { where: { status: RecordStatus.active }, select: { id: true } } }, orderBy: { [sortBy]: query.sortDir }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    return { items: items.map((entry) => ({ ...entry, hasValidBaseUnit: entry.itemUnits.filter((unit) => unit.isBaseUnit && unit.activeBaseItemId === entry.id).length === 1, activeBranchCount: entry.branchItems.length })), page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  async get(id: string) {
    const item = await this.prisma.item.findUnique({ where: { id }, include: { category: true, itemUnits: { include: { unit: true }, orderBy: { unit: { code: "asc" } } }, branchItems: { include: { branch: true, suppliers: { include: { supplier: true }, orderBy: { effectiveFrom: "asc" } } }, orderBy: { branch: { code: "asc" } } } } });
    if (!item) throw new NotFoundException("Item was not found.");
    return item;
  }

  async create(input: ItemInput, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.category(tx, input.categoryId, input.status !== RecordStatus.inactive);
        const item = await tx.item.create({ data: { sku: input.sku, barcode: clean(input.barcode), categoryId: input.categoryId, nameAr: input.nameAr, nameEn: clean(input.nameEn), nameUr: clean(input.nameUr), status: input.status ?? RecordStatus.active } });
        if (item.status === RecordStatus.active) throw new BadRequestException("Create the item inactive, add exactly one base unit, then activate it.");
        await this.audit(tx, actorUserId, "item", item.id, "created", undefined, { sku: item.sku, barcode: item.barcode, categoryId: item.categoryId, nameAr: item.nameAr, nameEn: item.nameEn, nameUr: item.nameUr, status: item.status });
        return item;
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Item SKU or barcode"); }
  }

  async update(id: string, input: Partial<ItemInput>, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await this.item(tx, id);
        const next = this.normalizeItem(input);
        if ((next.status ?? before.status) === RecordStatus.active) {
          await this.category(tx, next.categoryId ?? before.categoryId, true);
          await this.assertOperationalBase(tx, id);
        }
        const item = await tx.item.update({ where: { id }, data: { ...next, ...(next.status === RecordStatus.active ? { deletedAt: null } : next.status === RecordStatus.inactive ? { deletedAt: new Date() } : {}) } });
        await this.audit(tx, actorUserId, "item", id, item.status === RecordStatus.inactive ? "deactivated" : "updated", { sku: before.sku, barcode: before.barcode, categoryId: before.categoryId, status: before.status }, { sku: item.sku, barcode: item.barcode, categoryId: item.categoryId, status: item.status });
        return item;
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Item SKU or barcode"); }
  }

  async setStatus(id: string, status: RecordStatus, actorUserId: string) { return this.update(id, { status }, actorUserId); }

  async imageUrl(id: string) {
    const item = await this.prisma.item.findUnique({ where: { id }, select: { imageObjectKey: true } });
    if (!item) throw new NotFoundException("Item was not found.");
    if (!item.imageObjectKey) return { imageObjectKey: null, url: null };
    return { imageObjectKey: item.imageObjectKey, url: await this.storage.signedItemImageUrl(item.imageObjectKey) };
  }

  async replaceImage(id: string, bytes: Uint8Array, contentType: string, size: number, actorUserId: string) {
    const before = await this.prisma.item.findUnique({ where: { id }, select: { imageObjectKey: true } });
    if (!before) throw new NotFoundException("Item was not found.");
    const nextKey = await this.storage.putItemImage(id, bytes, contentType, size);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.item.update({ where: { id }, data: { imageObjectKey: nextKey } });
        await this.audit(tx, actorUserId, "item", id, "image_replaced", { imageObjectKey: before.imageObjectKey ? "present" : null }, { imageObjectKey: "present" });
      }, txOptions);
    } catch (error) { await this.storage.removeItemImage(nextKey).catch(() => undefined); throw error; }
    if (before.imageObjectKey) await this.storage.removeItemImage(before.imageObjectKey).catch(() => undefined);
    return { imageObjectKey: nextKey };
  }

  async removeImage(id: string, actorUserId: string) {
    const before = await this.prisma.item.findUnique({ where: { id }, select: { imageObjectKey: true } });
    if (!before) throw new NotFoundException("Item was not found.");
    await this.prisma.$transaction(async (tx) => { await tx.item.update({ where: { id }, data: { imageObjectKey: null } }); await this.audit(tx, actorUserId, "item", id, "image_removed", { imageObjectKey: before.imageObjectKey ? "present" : null }, { imageObjectKey: null }); }, txOptions);
    if (before.imageObjectKey) await this.storage.removeItemImage(before.imageObjectKey).catch(() => undefined);
    return { imageObjectKey: null };
  }

  async listUnits(itemId: string) { await this.item(this.prisma, itemId); return this.prisma.itemUnit.findMany({ where: { itemId }, include: { unit: true }, orderBy: { unit: { code: "asc" } } }); }

  async addUnit(itemId: string, input: ItemUnitInput, actorUserId: string) {
    const factor = new Prisma.Decimal(input.conversionFactorToBase);
    if (!factor.gt(0)) throw new BadRequestException("Conversion factor must be greater than zero.");
    if (input.isBaseUnit && !factor.equals(1)) throw new BadRequestException("A base unit conversion factor must equal 1.");
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.item(tx, itemId);
        const unit = await tx.unit.findUnique({ where: { id: input.unitId } });
        if (!unit || unit.status !== RecordStatus.active) throw new BadRequestException("Unit is not available.");
        if (input.isBaseUnit) await tx.itemUnit.updateMany({ where: { itemId, isBaseUnit: true }, data: { isBaseUnit: false, activeBaseItemId: null } });
        const status = input.status ?? RecordStatus.active;
        const row = await tx.itemUnit.create({ data: { itemId, unitId: input.unitId, conversionFactorToBase: factor, isBaseUnit: Boolean(input.isBaseUnit), status, activeBaseItemId: input.isBaseUnit && status === RecordStatus.active ? itemId : null } });
        await this.audit(tx, actorUserId, "item_unit", row.id, "created", undefined, { itemId, unitId: row.unitId, factor: row.conversionFactorToBase.toString(), isBaseUnit: row.isBaseUnit, status: row.status });
        return row;
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Item unit"); }
  }

  async updateUnit(itemId: string, itemUnitId: string, input: Partial<ItemUnitInput>, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.itemUnit.findFirst({ where: { id: itemUnitId, itemId } });
      if (!before) throw new NotFoundException("Item unit was not found.");
      const factor = input.conversionFactorToBase === undefined ? before.conversionFactorToBase : new Prisma.Decimal(input.conversionFactorToBase);
      const isBase = input.isBaseUnit ?? before.isBaseUnit;
      const status = input.status ?? before.status;
      if (!factor.gt(0)) throw new BadRequestException("Conversion factor must be greater than zero.");
      if (isBase && !factor.equals(1)) throw new BadRequestException("A base unit conversion factor must equal 1.");
      const parent = await this.item(tx, itemId);
      if (before.isBaseUnit && before.status === RecordStatus.active && status !== RecordStatus.active && parent.status === RecordStatus.active) throw new BadRequestException("Deactivate or change an active item's base unit only after selecting a replacement base unit.");
      if (isBase) await tx.itemUnit.updateMany({ where: { itemId, id: { not: itemUnitId }, isBaseUnit: true }, data: { isBaseUnit: false, activeBaseItemId: null } });
      const row = await tx.itemUnit.update({ where: { id: itemUnitId }, data: { conversionFactorToBase: factor, isBaseUnit: isBase, status, activeBaseItemId: isBase && status === RecordStatus.active ? itemId : null } });
      if (parent.status === RecordStatus.active) await this.assertOperationalBase(tx, itemId);
      await this.audit(tx, actorUserId, "item_unit", itemUnitId, "updated", { factor: before.conversionFactorToBase.toString(), isBaseUnit: before.isBaseUnit, status: before.status }, { factor: row.conversionFactorToBase.toString(), isBaseUnit: row.isBaseUnit, status: row.status });
      return row;
    }, txOptions);
  }

  async listBranches(itemId: string) { await this.item(this.prisma, itemId); return this.prisma.branchItem.findMany({ where: { itemId }, include: { branch: true, suppliers: { include: { supplier: true }, orderBy: { effectiveFrom: "asc" } } }, orderBy: { branch: { code: "asc" } } }); }

  async assignBranch(itemId: string, input: BranchItemInput, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await this.item(tx, itemId);
        const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
        if (!branch || branch.status !== RecordStatus.active) throw new BadRequestException("Branch is not available.");
        if ((input.status ?? RecordStatus.active) === RecordStatus.active) {
          if (item.status !== RecordStatus.active) throw new BadRequestException("Only active items may be assigned to an active branch.");
          await this.assertOperationalBase(tx, itemId);
        }
        const existing = await tx.branchItem.findUnique({ where: { branchId_itemId: { branchId: input.branchId, itemId } } });
        const row = existing ? await tx.branchItem.update({ where: { id: existing.id }, data: { status: input.status ?? RecordStatus.active, deletedAt: input.status === RecordStatus.inactive ? new Date() : null } }) : await tx.branchItem.create({ data: { branchId: input.branchId, itemId, status: input.status ?? RecordStatus.active } });
        await this.primaries.reconcileGuard(tx, row.id);
        await this.audit(tx, actorUserId, "branch_item", row.id, existing ? "restored_or_updated" : "created", undefined, { branchId: row.branchId, itemId: row.itemId, status: row.status });
        return row;
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Branch item"); }
  }

  async setBranchStatus(itemId: string, branchItemId: string, status: RecordStatus, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.branchItem.findFirst({ where: { id: branchItemId, itemId } });
      if (!before) throw new NotFoundException("Branch item was not found.");
      const row = await tx.branchItem.update({ where: { id: branchItemId }, data: { status, deletedAt: status === RecordStatus.inactive ? new Date() : null } });
      await this.primaries.reconcileGuard(tx, branchItemId);
      await this.audit(tx, actorUserId, "branch_item", branchItemId, status === RecordStatus.active ? "activated" : "deactivated", { status: before.status }, { status: row.status });
      return row;
    }, txOptions);
  }

  async listSuppliers(branchItemId: string) { const row = await this.prisma.branchItem.findUnique({ where: { id: branchItemId } }); if (!row) throw new NotFoundException("Branch item was not found."); return this.prisma.branchItemSupplier.findMany({ where: { branchItemId }, include: { supplier: true }, orderBy: { effectiveFrom: "asc" } }); }

  async upsertSupplier(branchItemId: string, input: SupplierInput, actorUserId: string) {
    const effectiveFrom = this.date(input.effectiveFrom, "Effective from");
    const effectiveTo = input.effectiveTo ? this.date(input.effectiveTo, "Effective to") : null;
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException("Effective to cannot be before effective from.");
    try {
      return await this.prisma.$transaction(async (tx) => {
        const parent = await tx.branchItem.findUnique({ where: { id: branchItemId }, include: { branch: true, item: true } });
        if (!parent || parent.status !== RecordStatus.active || parent.branch.status !== RecordStatus.active || parent.item.status !== RecordStatus.active) throw new BadRequestException("Branch item is not operationally active.");
        await this.assertOperationalBase(tx, parent.itemId);
        const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
        if (!supplier || supplier.status !== RecordStatus.active || supplier.deletedAt) throw new BadRequestException("Supplier is not available.");
        const existing = await tx.branchItemSupplier.findUnique({ where: { branchItemId_supplierId: { branchItemId, supplierId: input.supplierId } } });
        await this.primaries.lockBranchItem(tx, branchItemId);
        const status = input.status ?? existing?.status ?? RecordStatus.active;
        const isPrimary = input.isPrimary ?? existing?.isPrimary ?? false;
        if (status === RecordStatus.active && isPrimary) await this.primaries.assertNoOverlappingActivePrimary(tx, branchItemId, effectiveFrom, effectiveTo, existing?.id);
        const data = { status, isPrimary, effectiveFrom, effectiveTo, activePrimaryBranchItemId: null };
        const row = existing ? await tx.branchItemSupplier.update({ where: { id: existing.id }, data }) : await tx.branchItemSupplier.create({ data: { branchItemId, supplierId: input.supplierId, ...data } });
        await this.primaries.reconcileGuard(tx, branchItemId);
        await this.audit(tx, actorUserId, "branch_item_supplier", row.id, existing ? "updated" : "created", undefined, { branchItemId, supplierId: row.supplierId, status: row.status, isPrimary: row.isPrimary, effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10), effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null });
        return tx.branchItemSupplier.findUniqueOrThrow({ where: { id: row.id } });
      }, txOptions);
    } catch (error) { return this.duplicate(error, "Branch item supplier"); }
  }

  async setSupplierStatus(branchItemId: string, id: string, status: RecordStatus, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.branchItemSupplier.findFirst({ where: { id, branchItemId }, include: { supplier: true, branchItem: { include: { branch: true, item: true } } } });
      if (!before) throw new NotFoundException("Branch item supplier was not found.");
      if (status === RecordStatus.active) {
        if (before.supplier.status !== RecordStatus.active || before.supplier.deletedAt || before.branchItem.status !== RecordStatus.active || before.branchItem.branch.status !== RecordStatus.active || before.branchItem.item.status !== RecordStatus.active) throw new BadRequestException("Supplier relationship is not operationally valid for activation.");
        await this.assertOperationalBase(tx, before.branchItem.itemId);
      }
      await this.primaries.lockBranchItem(tx, branchItemId);
      if (status === RecordStatus.active && before.isPrimary) await this.primaries.assertNoOverlappingActivePrimary(tx, branchItemId, before.effectiveFrom, before.effectiveTo, before.id);
      const row = await tx.branchItemSupplier.update({ where: { id }, data: { status, activePrimaryBranchItemId: null } });
      await this.primaries.reconcileGuard(tx, branchItemId);
      await this.audit(tx, actorUserId, "branch_item_supplier", id, status === RecordStatus.active ? "activated" : "deactivated", { status: before.status }, { status: row.status });
      return tx.branchItemSupplier.findUniqueOrThrow({ where: { id: row.id } });
    }, txOptions);
  }
}
