import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, RecordStatus } from "@prisma/client";
import { secureMysqlUrl } from "../apps/api/src/config.js";
import { ItemsService } from "../apps/api/src/items.service.js";
import { AdminService } from "../apps/api/src/admin.service.js";
import { PrimarySupplierTemporalService } from "../apps/api/src/primary-supplier-temporal.service.js";
import { RequestLinePreparationService } from "../apps/api/src/request-line-preparation.service.js";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const temporal = new PrimarySupplierTemporalService(prisma as never);
const items = new ItemsService(prisma as never, {} as never, temporal);
const admin = new AdminService(prisma as never, temporal);
const linePreparation = new RequestLinePreparationService(prisma as never, temporal);
const suffix = randomUUID().slice(0, 8);
const actorId = randomUUID();
const ids = { user: "", branch: "", category: "", item: "", unit: "", itemUnit: "", branchItem: "", supplierA: "", supplierB: "", supplierC: "" };

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const input = (supplierId: string, effectiveFrom: string, effectiveTo?: string | null) => ({ supplierId, isPrimary: true, status: RecordStatus.active, effectiveFrom, effectiveTo });
const resetRelations = () => prisma.branchItemSupplier.updateMany({ where: { branchItemId: ids.branchItem }, data: { status: RecordStatus.inactive, activePrimaryBranchItemId: null } });

beforeAll(async () => {
  await prisma.$connect();
  const user = await prisma.user.create({ data: { username: `p4c1-${suffix}`, email: `p4c1-${suffix}@example.test`, passwordHash: "test-only" } });
  const [branch, category, unit, supplierA, supplierB, supplierC] = await Promise.all([
    prisma.branch.create({ data: { code: `P4C1-B-${suffix}`, nameAr: "فرع زمني", nameEn: "Temporal Branch" } }),
    prisma.category.create({ data: { code: `P4C1-C-${suffix}`, nameAr: "فئة زمنية" } }),
    prisma.unit.create({ data: { code: `P4C1-U-${suffix}`, nameAr: "وحدة" } }),
    prisma.supplier.create({ data: { supplierCode: `P4C1-A-${suffix}`, supplierName: "Supplier A" } }),
    prisma.supplier.create({ data: { supplierCode: `P4C1-B-${suffix}`, supplierName: "Supplier B" } }),
    prisma.supplier.create({ data: { supplierCode: `P4C1-C-${suffix}`, supplierName: "Supplier C" } }),
  ]);
  const item = await prisma.item.create({ data: { sku: `P4C1-SKU-${suffix}`, categoryId: category.id, nameAr: "عنصر زمني", status: RecordStatus.active } });
  const itemUnit = await prisma.itemUnit.create({ data: { itemId: item.id, unitId: unit.id, conversionFactorToBase: 1, isBaseUnit: true, status: RecordStatus.active, activeBaseItemId: item.id } });
  const branchItem = await prisma.branchItem.create({ data: { branchId: branch.id, itemId: item.id, status: RecordStatus.active } });
  Object.assign(ids, { user: user.id, branch: branch.id, category: category.id, item: item.id, unit: unit.id, itemUnit: itemUnit.id, branchItem: branchItem.id, supplierA: supplierA.id, supplierB: supplierB.id, supplierC: supplierC.id });
}, 120_000);

afterAll(async () => {
  await prisma.requestItem.deleteMany({ where: { request: { createdByUserId: ids.user } } });
  await prisma.requestRecord.deleteMany({ where: { createdByUserId: ids.user } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: ids.user } });
  await prisma.branchItemSupplier.deleteMany({ where: { branchItemId: ids.branchItem } });
  await prisma.branchItem.deleteMany({ where: { id: ids.branchItem } });
  await prisma.itemUnit.deleteMany({ where: { id: ids.itemUnit } });
  await prisma.item.deleteMany({ where: { id: ids.item } });
  await prisma.category.deleteMany({ where: { id: ids.category } });
  await prisma.unit.deleteMany({ where: { id: ids.unit } });
  await prisma.branch.deleteMany({ where: { id: ids.branch } });
  await prisma.supplier.deleteMany({ where: { id: { in: [ids.supplierA, ids.supplierB, ids.supplierC] } } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.$disconnect();
}, 120_000);

describe("P-004-C1 temporal primary supplier integrity", () => {
  it("keeps a future primary unselected before start and resolves it at its effective start without a configuration edit", async () => {
    await resetRelations();
    const future = await items.upsertSupplier(ids.branchItem, input(ids.supplierA, "2030-06-01"), ids.user);
    await expect(prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem, date("2030-05-31")))).resolves.toBeNull();
    const selected = await prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem, date("2030-06-01")));
    expect(selected?.id).toBe(future.id);
    expect(future.activePrimaryBranchItemId).toBeNull();
  }, 120_000);

  it("rejects overlapping active primary windows and resolves scheduled non-overlapping periods deterministically", async () => {
    await resetRelations();
    const first = await items.upsertSupplier(ids.branchItem, input(ids.supplierA, "2025-01-01", "2025-01-31"), ids.user);
    await expect(items.upsertSupplier(ids.branchItem, input(ids.supplierB, "2025-01-15", "2025-02-15"), ids.user)).rejects.toThrow(/overlap/i);
    const next = await items.upsertSupplier(ids.branchItem, input(ids.supplierB, "2025-02-01", null), ids.user);
    expect((await prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem, date("2025-01-31"))))?.id).toBe(first.id);
    expect((await prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem, date("2025-02-01"))))?.id).toBe(next.id);
    expect(await prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem, date("2024-12-31")))).toBeNull();
  }, 120_000);

  it("excludes expired suppliers, restores a current supplier after BranchItem reactivation, and reconciles supplier status changes", async () => {
    await resetRelations();
    const currentDay = new Date().toISOString().slice(0, 10);
    const expired = await items.upsertSupplier(ids.branchItem, { ...input(ids.supplierA, "2020-01-01", "2020-01-31"), isPrimary: false }, ids.user);
    expect(await prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem, date("2020-02-01")))).toBeNull();
    const current = await items.upsertSupplier(ids.branchItem, input(ids.supplierC, currentDay), ids.user);
    expect((await prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem)))?.id).toBe(current.id);
    await items.setBranchStatus(ids.item, ids.branchItem, RecordStatus.inactive, ids.user);
    expect(await prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem))).toBeNull();
    await items.setBranchStatus(ids.item, ids.branchItem, RecordStatus.active, ids.user);
    expect((await prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem)))?.id).toBe(current.id);
    await admin.setSupplierStatus(ids.supplierC, { status: RecordStatus.inactive }, ids.user);
    expect(await prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem))).toBeNull();
    await admin.setSupplierStatus(ids.supplierC, { status: RecordStatus.active }, ids.user);
    expect((await prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem)))?.id).toBe(current.id);
    expect(expired.activePrimaryBranchItemId).toBeNull();
  }, 120_000);

  it("enforces date-aware request snapshots and fails safely for legacy ambiguous current primaries", async () => {
    await resetRelations();
    const request = await prisma.requestRecord.create({ data: { requestNumber: `P4C1-R-${suffix}`, branchId: ids.branch, createdByUserId: ids.user } });
    await items.upsertSupplier(ids.branchItem, input(ids.supplierA, "2099-01-01"), ids.user);
    await expect(linePreparation.createDraftLine({ requestId: request.id, branchItemId: ids.branchItem, itemUnitId: ids.itemUnit, requestedQuantity: 1 })).rejects.toThrow(/primary supplier/i);
    await prisma.branchItemSupplier.updateMany({ where: { branchItemId: ids.branchItem }, data: { status: RecordStatus.inactive, activePrimaryBranchItemId: null } });
    const now = new Date().toISOString().slice(0, 10);
    const relationA = await prisma.branchItemSupplier.upsert({ where: { branchItemId_supplierId: { branchItemId: ids.branchItem, supplierId: ids.supplierA } }, update: { isPrimary: true, status: RecordStatus.active, effectiveFrom: date(now), effectiveTo: null, activePrimaryBranchItemId: null }, create: { branchItemId: ids.branchItem, supplierId: ids.supplierA, isPrimary: true, status: RecordStatus.active, effectiveFrom: date(now) } });
    const relationB = await prisma.branchItemSupplier.upsert({ where: { branchItemId_supplierId: { branchItemId: ids.branchItem, supplierId: ids.supplierB } }, update: { isPrimary: true, status: RecordStatus.active, effectiveFrom: date(now), effectiveTo: null, activePrimaryBranchItemId: null }, create: { branchItemId: ids.branchItem, supplierId: ids.supplierB, isPrimary: true, status: RecordStatus.active, effectiveFrom: date(now) } });
    await expect(prisma.$transaction((tx) => temporal.resolveCurrentPrimary(tx, ids.branchItem))).rejects.toThrow(/multiple current effective primary/i);
    await expect(linePreparation.createDraftLine({ requestId: request.id, branchItemId: ids.branchItem, itemUnitId: ids.itemUnit, requestedQuantity: 1 })).rejects.toThrow(/multiple current effective primary/i);
    await prisma.branchItemSupplier.update({ where: { id: relationB.id }, data: { status: RecordStatus.inactive } });
    await expect(linePreparation.createDraftLine({ requestId: request.id, branchItemId: ids.branchItem, itemUnitId: ids.itemUnit, requestedQuantity: 1 })).resolves.toMatchObject({ branchItemSupplierIdSnapshot: relationA.id });
  }, 120_000);
});
