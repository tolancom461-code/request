import argon2 from "argon2";
import request from "supertest";
import { PrismaClient, RecordStatus, RequestStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication } from "../apps/api/src/main.js";
import { secureMysqlUrl } from "../apps/api/src/config.js";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const password = "phase5c1-test-password";
let app: NestFastifyApplication;
let suffix = "";
let ownerId = "";
let branchId = "";
let primaryBranchItemId = "";
let secondaryBranchItemId = "";
let primaryUnitId = "";
let alternatePrimaryUnitId = "";
let secondaryUnitId = "";
let ownerCookie = "";
let ownerCsrf = "";

const url = (path: string) => `/api/v1${path}`;
const mutate = () => ({ Cookie: ownerCookie, Origin: "http://localhost:3000", "X-CSRF-Token": ownerCsrf });

async function login(username: string) {
  const response = await request(app.getHttpServer()).post(url("/auth/login")).send({ username, password });
  expect(response.status).toBe(201);
  ownerCookie = String(response.headers["set-cookie"]?.[0]).split(";")[0];
  ownerCsrf = response.body.csrfToken as string;
}

async function createReturnedRequest() {
  const created = await request(app.getHttpServer()).post(url("/requisitions")).set(mutate()).send({ branchId });
  expect(created.status).toBe(201);
  const added = await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/items`)).set(mutate()).send({ branchItemId: primaryBranchItemId, itemUnitId: primaryUnitId, requestedQuantity: "1", expectedRowVersion: created.body.rowVersion });
  expect(added.status).toBe(201);
  const submitted = await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/submit`)).set(mutate()).send({ expectedRowVersion: added.body.rowVersion });
  expect(submitted.status).toBe(201);
  await prisma.requestRecord.update({ where: { id: created.body.id }, data: { status: RequestStatus.returned } });
  const returned = await request(app.getHttpServer()).get(url(`/requisitions/${created.body.id}`)).set("Cookie", ownerCookie);
  expect(returned.status).toBe(200);
  return { requestId: created.body.id as string, initialSubmittedAt: submitted.body.submittedAt as string, detail: returned.body as { rowVersion: number; items: Array<{ id: string; branchItemId: string; itemUnitId: string; requestedQuantity: string }> } };
}

async function cleanup() {
  const requests = await prisma.requestRecord.findMany({ where: { createdByUserId: ownerId }, include: { items: { select: { id: true } } } });
  for (const entry of requests) {
    await prisma.requestStatusHistory.deleteMany({ where: { requestId: entry.id } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: entry.id }, { entityId: { in: entry.items.map((line) => line.id) } }] } });
    await prisma.requestItem.deleteMany({ where: { requestId: entry.id } });
    await prisma.requestRecord.delete({ where: { id: entry.id } });
  }
  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  if (owner) {
    await prisma.userBranchScope.deleteMany({ where: { userId: ownerId } });
    await prisma.userRole.deleteMany({ where: { userId: ownerId } });
    await prisma.user.delete({ where: { id: ownerId } });
  }
  await prisma.branchItemSupplier.deleteMany({ where: { branchItem: { branchId } } });
  await prisma.branchItem.deleteMany({ where: { branchId } });
  await prisma.itemUnit.deleteMany({ where: { item: { sku: { startsWith: `P5C1-SKU-${suffix}` } } } });
  await prisma.item.deleteMany({ where: { sku: { startsWith: `P5C1-SKU-${suffix}` } } });
  await prisma.unit.deleteMany({ where: { code: { startsWith: `P5C1-U-${suffix}` } } });
  await prisma.supplier.deleteMany({ where: { supplierCode: { startsWith: `P5C1-SUP-${suffix}` } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: `P5C1-CAT-${suffix}` } } });
  await prisma.branch.deleteMany({ where: { code: `P5C1-BR-${suffix}` } });
}

beforeAll(async () => {
  process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
  await prisma.$connect();
  suffix = crypto.randomUUID().slice(0, 8);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "branch_employee" } });
  const branch = await prisma.branch.create({ data: { code: `P5C1-BR-${suffix}`, nameAr: "فرع الذرية", nameEn: "Atomic Branch" } });
  branchId = branch.id;
  const category = await prisma.category.create({ data: { code: `P5C1-CAT-${suffix}`, nameAr: "فئة الذرية", nameEn: "Atomic Category" } });
  const supplier = await prisma.supplier.create({ data: { supplierCode: `P5C1-SUP-${suffix}`, supplierName: "مورد الذرية" } });
  const primaryItem = await prisma.item.create({ data: { sku: `P5C1-SKU-${suffix}-A`, categoryId: category.id, nameAr: "صنف أول", nameEn: "Primary Item" } });
  const secondaryItem = await prisma.item.create({ data: { sku: `P5C1-SKU-${suffix}-B`, categoryId: category.id, nameAr: "صنف ثان", nameEn: "Secondary Item" } });
  const primaryUnit = await prisma.unit.create({ data: { code: `P5C1-U-${suffix}-EA`, nameAr: "قطعة", nameEn: "Each" } });
  const alternateUnit = await prisma.unit.create({ data: { code: `P5C1-U-${suffix}-BOX`, nameAr: "علبة", nameEn: "Box" } });
  const secondaryUnit = await prisma.unit.create({ data: { code: `P5C1-U-${suffix}-KG`, nameAr: "كيلوغرام", nameEn: "Kilogram" } });
  primaryUnitId = (await prisma.itemUnit.create({ data: { itemId: primaryItem.id, unitId: primaryUnit.id, conversionFactorToBase: 1, isBaseUnit: true, activeBaseItemId: primaryItem.id } })).id;
  alternatePrimaryUnitId = (await prisma.itemUnit.create({ data: { itemId: primaryItem.id, unitId: alternateUnit.id, conversionFactorToBase: 12, isBaseUnit: false } })).id;
  secondaryUnitId = (await prisma.itemUnit.create({ data: { itemId: secondaryItem.id, unitId: secondaryUnit.id, conversionFactorToBase: 1, isBaseUnit: true, activeBaseItemId: secondaryItem.id } })).id;
  primaryBranchItemId = (await prisma.branchItem.create({ data: { branchId, itemId: primaryItem.id } })).id;
  secondaryBranchItemId = (await prisma.branchItem.create({ data: { branchId, itemId: secondaryItem.id } })).id;
  await prisma.branchItemSupplier.createMany({ data: [
    { branchItemId: primaryBranchItemId, supplierId: supplier.id, isPrimary: true, activePrimaryBranchItemId: primaryBranchItemId, effectiveFrom: new Date() },
    { branchItemId: secondaryBranchItemId, supplierId: supplier.id, isPrimary: true, activePrimaryBranchItemId: secondaryBranchItemId, effectiveFrom: new Date() },
  ] });
  const owner = await prisma.user.create({ data: { username: `p5c1-owner-${suffix}`, email: `p5c1-owner-${suffix}@example.test`, passwordHash: await argon2.hash(password) } });
  ownerId = owner.id;
  await prisma.userRole.create({ data: { userId: owner.id, roleId: role.id } });
  await prisma.userBranchScope.create({ data: { userId: owner.id, branchId } });
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await login(owner.username);
}, 120_000);

afterAll(async () => { await cleanup(); await app?.close(); await prisma.$disconnect(); }, 120_000);

describe("P-005-C1 returned-request atomic mutations", () => {
  it("TC-P5C1-01 rolls back quantity, unit, audit and rowVersion when returned edit has a foreign unit", async () => {
    const returned = await createReturnedRequest();
    const line = returned.detail.items[0];
    const auditBefore = await prisma.auditLog.count({ where: { entityId: line.id, action: "returned_line_updated" } });
    const failed = await request(app.getHttpServer()).patch(url(`/requisitions/${returned.requestId}/items/${line.id}`)).set(mutate()).send({ branchItemId: primaryBranchItemId, itemUnitId: secondaryUnitId, requestedQuantity: "7", expectedRowVersion: returned.detail.rowVersion });
    expect(failed.status).toBe(400);
    const stored = await prisma.requestRecord.findUniqueOrThrow({ where: { id: returned.requestId }, include: { items: { where: { id: line.id } } } });
    expect(stored.rowVersion).toBe(returned.detail.rowVersion);
    expect(stored.items[0].requestedQuantity.toString()).toBe("1");
    expect(stored.items[0].itemUnitIdSnapshot).toBe(primaryUnitId);
    expect(await prisma.auditLog.count({ where: { entityId: line.id, action: "returned_line_updated" } })).toBe(auditBefore);
  }, 120_000);

  it("TC-P5C1-02 commits returned quantity and unit together with exactly one rowVersion increment", async () => {
    const returned = await createReturnedRequest();
    const line = returned.detail.items[0];
    const success = await request(app.getHttpServer()).patch(url(`/requisitions/${returned.requestId}/items/${line.id}`)).set(mutate()).send({ branchItemId: primaryBranchItemId, itemUnitId: alternatePrimaryUnitId, requestedQuantity: "4", expectedRowVersion: returned.detail.rowVersion });
    expect(success.status).toBe(200);
    expect(success.body.rowVersion).toBe(returned.detail.rowVersion + 1);
    expect(success.body.items[0]).toMatchObject({ requestedQuantity: "4", itemUnitId: alternatePrimaryUnitId });
    expect(await prisma.auditLog.count({ where: { entityId: line.id, action: "returned_line_updated" } })).toBe(1);
  }, 120_000);

  it("TC-P5C1-03 leaves no partial line, audit or version drift when returned add validation fails", async () => {
    const returned = await createReturnedRequest();
    const auditBefore = await prisma.auditLog.count({ where: { action: "returned_line_added" } });
    const failed = await request(app.getHttpServer()).post(url(`/requisitions/${returned.requestId}/returned-items`)).set(mutate()).send({ branchItemId: secondaryBranchItemId, itemUnitId: primaryUnitId, requestedQuantity: "2", expectedRowVersion: returned.detail.rowVersion });
    expect(failed.status).toBe(400);
    const stored = await prisma.requestRecord.findUniqueOrThrow({ where: { id: returned.requestId }, include: { items: true } });
    expect(stored.rowVersion).toBe(returned.detail.rowVersion);
    expect(stored.items.some((line) => line.branchItemIdSnapshot === secondaryBranchItemId && line.lineStatus === "active")).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: "returned_line_added" } })).toBe(auditBefore);
  }, 120_000);

  it("TC-P5C1-04 accepts exactly one concurrent returned add/upsert path and rejects stale rowVersion", async () => {
    const returned = await createReturnedRequest();
    const outcomes = await Promise.all([
      request(app.getHttpServer()).post(url(`/requisitions/${returned.requestId}/returned-items`)).set(mutate()).send({ branchItemId: secondaryBranchItemId, itemUnitId: secondaryUnitId, requestedQuantity: "2", expectedRowVersion: returned.detail.rowVersion }),
      request(app.getHttpServer()).post(url(`/requisitions/${returned.requestId}/returned-items`)).set(mutate()).send({ branchItemId: secondaryBranchItemId, itemUnitId: secondaryUnitId, requestedQuantity: "3", expectedRowVersion: returned.detail.rowVersion }),
    ]);
    expect(outcomes.filter((entry) => entry.status === 201)).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === 409)).toHaveLength(1);
    const stored = await prisma.requestRecord.findUniqueOrThrow({ where: { id: returned.requestId }, include: { items: true } });
    expect(stored.rowVersion).toBe(returned.detail.rowVersion + 1);
    expect(stored.items.filter((line) => line.branchItemIdSnapshot === secondaryBranchItemId && line.lineStatus === "active")).toHaveLength(1);
  }, 120_000);

  it("TC-P5C1-05 preserves first submittedAt and refreshes snapshots through valid returned resubmission", async () => {
    const returned = await createReturnedRequest();
    const line = returned.detail.items[0];
    const edited = await request(app.getHttpServer()).patch(url(`/requisitions/${returned.requestId}/items/${line.id}`)).set(mutate()).send({ branchItemId: primaryBranchItemId, itemUnitId: alternatePrimaryUnitId, requestedQuantity: "5", expectedRowVersion: returned.detail.rowVersion });
    expect(edited.status).toBe(200);
    const added = await request(app.getHttpServer()).post(url(`/requisitions/${returned.requestId}/returned-items`)).set(mutate()).send({ branchItemId: secondaryBranchItemId, itemUnitId: secondaryUnitId, requestedQuantity: "2", expectedRowVersion: edited.body.rowVersion });
    expect(added.status).toBe(201);
    const resubmitted = await request(app.getHttpServer()).post(url(`/requisitions/${returned.requestId}/resubmit`)).set(mutate()).send({ expectedRowVersion: added.body.rowVersion });
    expect(resubmitted.status).toBe(201);
    expect(resubmitted.body).toMatchObject({ status: RequestStatus.pending_approval, submittedAt: returned.initialSubmittedAt });
    const detail = await request(app.getHttpServer()).get(url(`/requisitions/${returned.requestId}`)).set("Cookie", ownerCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.items).toHaveLength(2);
    expect(detail.body.items.every((entry: { itemUnitId: string }) => [alternatePrimaryUnitId, secondaryUnitId].includes(entry.itemUnitId))).toBe(true);
  }, 120_000);
});
