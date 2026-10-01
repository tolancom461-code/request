import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient, RecordStatus, RequestStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { secureMysqlUrl } from "../apps/api/src/config.js";
import { MasterDataIntegrityService } from "../apps/api/src/master-data-integrity.service.js";
import { RequestLinePreparationService } from "../apps/api/src/request-line-preparation.service.js";
import { RequestSubmissionService } from "../apps/api/src/request-submission.service.js";

const prisma = new PrismaClient({
  datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } },
  transactionOptions: { maxWait: 15_000, timeout: 60_000 },
});
const masterData = new MasterDataIntegrityService(prisma as never);
const linePreparation = new RequestLinePreparationService(prisma as never);
const submissions = new RequestSubmissionService(prisma as never, linePreparation);

async function fixture() {
  const token = randomUUID().slice(0, 8);
  const now = new Date();
  const user = await prisma.user.create({ data: { username: `test-user-${token}`, email: `test-${token}@example.test`, passwordHash: "test-only", updatedAt: now } });
  const branch = await prisma.branch.create({ data: { code: `TEST-${token}`, nameAr: "فرع اختبار", nameEn: "Test Branch", updatedAt: now } });
  const category = await prisma.category.create({ data: { code: `TEST-CAT-${token}`, nameAr: "فئة اختبار" } });
  const item = await prisma.item.create({ data: { sku: `TEST-SKU-${token}`, categoryId: category.id, nameAr: "صنف اختبار" } });
  const unit = await prisma.unit.create({ data: { code: `TEST-U-${token}`, nameAr: "وحدة اختبار" } });
  const itemUnit = await masterData.createItemUnit({ itemId: item.id, unitId: unit.id, conversionFactorToBase: 1, isBaseUnit: true, status: RecordStatus.active });
  const branchItem = await prisma.branchItem.create({ data: { branchId: branch.id, itemId: item.id } });
  const supplier = await prisma.supplier.create({ data: { supplierCode: `TEST-SUP-${token}`, supplierName: "Test Supplier" } });
  const supplierRelation = await masterData.createBranchItemSupplier({ branchItemId: branchItem.id, supplierId: supplier.id, isPrimary: true, status: RecordStatus.active, effectiveFrom: now });
  const request = await prisma.requestRecord.create({ data: { requestNumber: `TEST-REQ-${token}`, branchId: branch.id, createdByUserId: user.id, updatedAt: now } });
  return { user, branch, category, item, unit, itemUnit, branchItem, supplier, supplierRelation, request };
}

async function cleanup(userEmail: string) {
  const findUser = () => prisma.user.findUnique({ where: { email: userEmail } });
  let user;
  try {
    user = await findUser();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Server has closed the connection")) throw error;
    await prisma.$disconnect();
    await prisma.$connect();
    user = await findUser();
  }
  if (!user) return;
  const requests = await prisma.requestRecord.findMany({ where: { createdByUserId: user.id } });
  for (const request of requests) {
    await prisma.requestStatusHistory.deleteMany({ where: { requestId: request.id } });
    await prisma.auditLog.deleteMany({ where: { entityId: request.id } });
    await prisma.requestItem.deleteMany({ where: { requestId: request.id } });
    await prisma.requestRecord.delete({ where: { id: request.id } });
  }
  await prisma.user.delete({ where: { id: user.id } });
}

async function afterConnectionReset<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Server has closed the connection")) throw error;
    await prisma.$disconnect();
    await prisma.$connect();
    return operation();
  }
}

beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("Phase 2A TiDB historical integrity", () => {
  it("TC-FK-01 rejects invalid Item → Category", async () => {
    const token = randomUUID().slice(0, 8);
    await expect(prisma.$executeRawUnsafe("INSERT INTO items (id, sku, category_id, name_ar, status) VALUES (?, ?, ?, ?, ?)", randomUUID(), `FK-ITEM-${token}`, randomUUID(), "FK test", "active")).rejects.toThrow(/foreign key/i);
  });

  it("TC-FK-02 rejects invalid Request → Branch", async () => {
    const token = randomUUID().slice(0, 8);
    await expect(prisma.$executeRawUnsafe("INSERT INTO requests (id, request_number, branch_id, created_by_user_id, status, row_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(3))", randomUUID(), `FK-REQUEST-${token}`, randomUUID(), randomUUID(), "draft", 1)).rejects.toThrow(/foreign key/i);
  });

  it("TC-FK-03 rejects invalid User Branch Scope → User/Branch", async () => {
    await expect(prisma.$executeRawUnsafe("INSERT INTO user_branch_scopes (user_id, branch_id) VALUES (?, ?)", randomUUID(), randomUUID())).rejects.toThrow(/foreign key/i);
  });

  it("TC-FK-04 rejects invalid Request Item → Request", async () => {
    const token = randomUUID().slice(0, 8);
    await expect(prisma.$executeRawUnsafe("INSERT INTO request_items (id, request_id, branch_item_id_snapshot, item_id_snapshot, item_unit_id_snapshot, branch_item_supplier_id_snapshot, supplier_id_snapshot, supplier_code_snapshot, supplier_name_snapshot, requested_quantity, conversion_factor_snapshot, base_quantity_snapshot, line_status, added_after_first_submission) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), `FK-SUP-${token}`, "FK supplier", "1.000000", "1.000000", "1.000000", "active", false)).rejects.toThrow(/foreign key/i);
  });

  it("TC-FK-05 rejects invalid Request Item supplier snapshot reference", async () => {
    const data = await fixture();
    try {
      await expect(prisma.requestItem.create({ data: {
        id: randomUUID(), requestId: data.request.id, branchItemIdSnapshot: data.branchItem.id, itemIdSnapshot: data.item.id,
        itemUnitIdSnapshot: data.itemUnit.id, branchItemSupplierIdSnapshot: randomUUID(), supplierIdSnapshot: randomUUID(),
        supplierCodeSnapshot: "INVALID-FK", supplierNameSnapshot: "Invalid FK", requestedQuantity: "1", conversionFactorSnapshot: "1", baseQuantitySnapshot: "1",
      } })).rejects.toThrow(/foreign key/i);
    } finally {
      await cleanup(data.user.email);
    }
  });

  it("TC-DB-01 refreshes supplier/unit/base-quantity snapshots only at first submission", async () => {
    const data = await fixture();
    try {
      const draftLine = await linePreparation.createDraftLine({ requestId: data.request.id, branchItemId: data.branchItem.id, itemUnitId: data.itemUnit.id, requestedQuantity: 3 });
      const replacementSupplier = await prisma.supplier.create({ data: { supplierCode: `TEST-REPLACEMENT-${randomUUID().slice(0, 8)}`, supplierName: "Replacement Supplier" } });
      const replacementRelation = await masterData.createBranchItemSupplier({ branchItemId: data.branchItem.id, supplierId: replacementSupplier.id, isPrimary: false, status: RecordStatus.active, effectiveFrom: new Date() });
      await masterData.replaceActivePrimarySupplier({ previousRelationId: data.supplierRelation.id, nextRelationId: replacementRelation.id });
      const submitted = await submissions.submitFirstTime(data.request.id, data.user.id);
      const authoritativeLine = await prisma.requestItem.findUniqueOrThrow({ where: { id: draftLine.id } });
      expect(submitted.status).toBe(RequestStatus.pending_approval);
      expect(authoritativeLine.supplierCodeSnapshot).toBe(replacementSupplier.supplierCode);
      expect(authoritativeLine.conversionFactorSnapshot.toString()).toBe("1");
      expect(authoritativeLine.baseQuantitySnapshot.toString()).toBe("3");
    } finally { await cleanup(data.user.email); }
  });

  it("TC-DB-02 makes first submission concurrency-safe with exactly one transition and audit event", async () => {
    const data = await fixture();
    try {
      await linePreparation.createDraftLine({ requestId: data.request.id, branchItemId: data.branchItem.id, itemUnitId: data.itemUnit.id, requestedQuantity: 1 });
      const outcomes = await Promise.allSettled([submissions.submitFirstTime(data.request.id, data.user.id), submissions.submitFirstTime(data.request.id, data.user.id)]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      expect(await afterConnectionReset(() => prisma.requestStatusHistory.count({ where: { requestId: data.request.id, fromStatus: RequestStatus.draft, toStatus: RequestStatus.pending_approval } }))).toBe(1);
      expect(await afterConnectionReset(() => prisma.auditLog.count({ where: { entityId: data.request.id, action: "first_submitted" } }))).toBe(1);
      expect((await afterConnectionReset(() => prisma.requestRecord.findUniqueOrThrow({ where: { id: data.request.id } }))).submittedAt).not.toBeNull();
    } finally { await cleanup(data.user.email); }
  });

  it("TC-DB-03 uses logical exclusion and has no production request-item physical-delete path", async () => {
    const data = await fixture();
    try {
      const line = await linePreparation.createDraftLine({ requestId: data.request.id, branchItemId: data.branchItem.id, itemUnitId: data.itemUnit.id, requestedQuantity: 1 });
      const excluded = await linePreparation.excludeLine({ requestId: data.request.id, requestItemId: line.id, actorUserId: data.user.id });
      expect(excluded.lineStatus).toBe("excluded");
      expect(excluded.removalReason).toBe("removed_before_first_submission");
      expect(await prisma.requestItem.findUnique({ where: { id: line.id } })).not.toBeNull();
      const source = await readFile(new URL("../apps/api/src/request-submission.service.ts", import.meta.url), "utf8");
      expect(source).not.toContain("requestItem.delete(");
      expect(source).not.toContain("deleteNeverSubmittedDraftLine");
    } finally { await cleanup(data.user.email); }
  });

  it("TC-DB-04 supports audited returned-request edit, unit change, exclusion, addition and resubmission without clearing submittedAt", async () => {
    const data = await fixture();
    try {
      const original = await linePreparation.createDraftLine({ requestId: data.request.id, branchItemId: data.branchItem.id, itemUnitId: data.itemUnit.id, requestedQuantity: 2 });
      const first = await submissions.submitFirstTime(data.request.id, data.user.id);
      const originalSubmittedAt = first.submittedAt!;
      await prisma.requestRecord.update({ where: { id: data.request.id }, data: { status: RequestStatus.returned } });
      const altUnit = await prisma.unit.create({ data: { code: `TEST-ALT-${randomUUID().slice(0, 8)}`, nameAr: "وحدة بديلة" } });
      const altItemUnit = await masterData.createItemUnit({ itemId: data.item.id, unitId: altUnit.id, conversionFactorToBase: 2, isBaseUnit: false, status: RecordStatus.active });
      await linePreparation.changeReturnedLineQuantity({ requestId: data.request.id, requestItemId: original.id, requestedQuantity: 4, actorUserId: data.user.id });
      await linePreparation.changeReturnedLineUnit({ requestId: data.request.id, requestItemId: original.id, itemUnitId: altItemUnit.id, actorUserId: data.user.id });
      await linePreparation.excludeLine({ requestId: data.request.id, requestItemId: original.id, actorUserId: data.user.id, removalReason: "manager_requested_revision" });
      const added = await linePreparation.addReturnedLine({ requestId: data.request.id, branchItemId: data.branchItem.id, itemUnitId: altItemUnit.id, requestedQuantity: 3, actorUserId: data.user.id });
      expect(added.addedAfterFirstSubmission).toBe(true);
      const resubmitted = await submissions.resubmitReturned(data.request.id, data.user.id);
      expect(resubmitted.status).toBe(RequestStatus.pending_approval);
      expect(resubmitted.submittedAt?.toISOString()).toBe(originalSubmittedAt.toISOString());
      expect((await prisma.requestItem.findUniqueOrThrow({ where: { id: added.id } })).baseQuantitySnapshot.toString()).toBe("6");
      expect(await prisma.auditLog.count({ where: { entityId: data.request.id, action: "returned_request_resubmitted" } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: original.id, action: "request_line_excluded" } })).toBe(1);
    } finally { await cleanup(data.user.email); }
  });

  it("TC-DB-05 rolls back returned-request resubmission when an active line becomes invalid", async () => {
    const data = await fixture();
    try {
      const line = await linePreparation.createDraftLine({ requestId: data.request.id, branchItemId: data.branchItem.id, itemUnitId: data.itemUnit.id, requestedQuantity: 1 });
      await submissions.submitFirstTime(data.request.id, data.user.id);
      await prisma.requestRecord.update({ where: { id: data.request.id }, data: { status: RequestStatus.returned } });
      await prisma.branchItem.update({ where: { id: data.branchItem.id }, data: { status: RecordStatus.inactive } });
      await expect(submissions.resubmitReturned(data.request.id, data.user.id)).rejects.toThrow(/not active/i);
      expect((await prisma.requestRecord.findUniqueOrThrow({ where: { id: data.request.id } })).status).toBe(RequestStatus.returned);
      expect(await prisma.auditLog.count({ where: { entityId: data.request.id, action: "returned_request_resubmitted" } })).toBe(0);
      expect(await prisma.requestItem.findUnique({ where: { id: line.id } })).not.toBeNull();
    } finally { await cleanup(data.user.email); }
  });

  it("TC-DB-06 maintains base-unit and primary-supplier guard keys through replacement", async () => {
    const data = await fixture();
    try {
      const nextUnit = await prisma.unit.create({ data: { code: `TEST-U2-${randomUUID().slice(0, 8)}`, nameAr: "وحدة ثانية" } });
      await expect(masterData.createItemUnit({ itemId: data.item.id, unitId: nextUnit.id, conversionFactorToBase: 0, isBaseUnit: false, status: RecordStatus.active })).rejects.toThrow(/positive/i);
      await expect(masterData.createItemUnit({ itemId: data.item.id, unitId: nextUnit.id, conversionFactorToBase: 1, isBaseUnit: true, status: RecordStatus.active })).rejects.toThrow(/base unit/i);
      const inactiveNext = await masterData.createItemUnit({ itemId: data.item.id, unitId: nextUnit.id, conversionFactorToBase: 1, isBaseUnit: false, status: RecordStatus.inactive });
      const newBase = await masterData.replaceActiveBaseUnit({ previousItemUnitId: data.itemUnit.id, nextItemUnitId: inactiveNext.id });
      expect(newBase.activeBaseItemId).toBe(data.item.id);
      const nextSupplier = await prisma.supplier.create({ data: { supplierCode: `TEST-SUP2-${randomUUID().slice(0, 8)}`, supplierName: "Second Test Supplier" } });
      await expect(masterData.createBranchItemSupplier({ branchItemId: data.branchItem.id, supplierId: nextSupplier.id, isPrimary: true, status: RecordStatus.active, effectiveFrom: new Date() })).rejects.toThrow(/primary supplier/i);
      const secondary = await masterData.createBranchItemSupplier({ branchItemId: data.branchItem.id, supplierId: nextSupplier.id, isPrimary: false, status: RecordStatus.active, effectiveFrom: new Date() });
      const primary = await masterData.replaceActivePrimarySupplier({ previousRelationId: data.supplierRelation.id, nextRelationId: secondary.id });
      expect(primary.activePrimaryBranchItemId).toBe(data.branchItem.id);
    } finally { await cleanup(data.user.email); }
  });

  it("TC-DB-07 persists a system actor event without creating a fake user", async () => {
    const data = await fixture();
    try {
      const audit = await submissions.recordSystemEvent(data.request.id, RequestStatus.pending_approval, "automated_test_event");
      expect(audit.actorType).toBe("system");
      expect(audit.actorUserId).toBeNull();
      expect((await prisma.requestStatusHistory.findFirstOrThrow({ where: { requestId: data.request.id, actorType: "system" } })).actorUserId).toBeNull();
    } finally { await cleanup(data.user.email); }
  });
});
