import argon2 from "argon2";
import request from "supertest";
import { PrismaClient, RecordStatus, RequestStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication } from "../apps/api/src/main.js";
import { secureMysqlUrl } from "../apps/api/src/config.js";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const password = "phase5-test-password";
let app: NestFastifyApplication;
let suffix = "";
let ownerId = "";
let branchId = "";
let otherBranchId = "";
let categoryId = "";
let branchItemId = "";
let itemUnitId = "";
let otherUnitId = "";
let ownerCookie = "";
let ownerCsrf = "";
let otherCookie = "";
let otherCsrf = "";

const url = (path: string) => `/api/v1${path}`;
const mutate = (cookie: string, csrf: string) => ({ Cookie: cookie, Origin: "http://localhost:5173", "X-CSRF-Token": csrf });

async function login(username: string) {
  const response = await request(app.getHttpServer()).post(url("/auth/login")).send({ username, password });
  expect(response.status).toBe(201);
  return { cookie: String(response.headers["set-cookie"]?.[0]).split(";")[0], csrf: response.body.csrfToken as string };
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
  const users = await prisma.user.findMany({ where: { email: { contains: suffix } } });
  for (const user of users) {
    await prisma.userBranchScope.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.branchItemSupplier.deleteMany({ where: { branchItem: { branchId } } });
  await prisma.branchItem.deleteMany({ where: { branchId } });
  await prisma.itemUnit.deleteMany({ where: { item: { sku: { startsWith: `P5-SKU-${suffix}` } } } });
  await prisma.item.deleteMany({ where: { sku: { startsWith: `P5-SKU-${suffix}` } } });
  await prisma.unit.deleteMany({ where: { code: { startsWith: `P5-U-${suffix}` } } });
  await prisma.supplier.deleteMany({ where: { supplierCode: { startsWith: `P5-SUP-${suffix}` } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: `P5-CAT-${suffix}` } } });
  await prisma.branch.deleteMany({ where: { code: { in: [`P5-BR-${suffix}`, `P5-OTHER-${suffix}`] } } });
}

beforeAll(async () => {
  process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
  await prisma.$connect();
  suffix = crypto.randomUUID().slice(0, 8);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "branch_employee" } });
  const branch = await prisma.branch.create({ data: { code: `P5-BR-${suffix}`, nameAr: "فرع طلب", nameEn: "Requisition Branch" } });
  const other = await prisma.branch.create({ data: { code: `P5-OTHER-${suffix}`, nameAr: "فرع آخر", nameEn: "Other Branch" } });
  branchId = branch.id;
  otherBranchId = other.id;
  const category = await prisma.category.create({ data: { code: `P5-CAT-${suffix}`, nameAr: "فئة طلب", nameEn: "Request Category" } });
  categoryId = category.id;
  const item = await prisma.item.create({ data: { sku: `P5-SKU-${suffix}`, categoryId, nameAr: "صنف طلب", nameEn: "Requisition Item", nameUr: "درخواست آئٹم" } });
  const unit = await prisma.unit.create({ data: { code: `P5-U-${suffix}`, nameAr: "قطعة", nameEn: "Piece" } });
  const extraUnit = await prisma.unit.create({ data: { code: `P5-U-${suffix}-ALT`, nameAr: "علبة", nameEn: "Box" } });
  const base = await prisma.itemUnit.create({ data: { itemId: item.id, unitId: unit.id, conversionFactorToBase: 1, isBaseUnit: true, activeBaseItemId: item.id } });
  otherUnitId = (await prisma.itemUnit.create({ data: { itemId: item.id, unitId: extraUnit.id, conversionFactorToBase: 12, isBaseUnit: false } })).id;
  itemUnitId = base.id;
  const branchItem = await prisma.branchItem.create({ data: { branchId, itemId: item.id } });
  branchItemId = branchItem.id;
  const supplier = await prisma.supplier.create({ data: { supplierCode: `P5-SUP-${suffix}`, supplierName: "مورد طلب" } });
  await prisma.branchItemSupplier.create({ data: { branchItemId, supplierId: supplier.id, isPrimary: true, activePrimaryBranchItemId: branchItemId, effectiveFrom: new Date() } });
  const owner = await prisma.user.create({ data: { username: `p5-owner-${suffix}`, email: `p5-owner-${suffix}@example.test`, passwordHash: await argon2.hash(password) } });
  ownerId = owner.id;
  await prisma.userRole.create({ data: { userId: owner.id, roleId: role.id } });
  await prisma.userBranchScope.create({ data: { userId: owner.id, branchId } });
  const otherUser = await prisma.user.create({ data: { username: `p5-other-${suffix}`, email: `p5-other-${suffix}@example.test`, passwordHash: await argon2.hash(password) } });
  await prisma.userRole.create({ data: { userId: otherUser.id, roleId: role.id } });
  await prisma.userBranchScope.create({ data: { userId: otherUser.id, branchId: otherBranchId } });
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const ownerSession = await login(owner.username);
  ownerCookie = ownerSession.cookie;
  ownerCsrf = ownerSession.csrf;
  const otherSession = await login(otherUser.username);
  otherCookie = otherSession.cookie;
  otherCsrf = otherSession.csrf;
});

afterAll(async () => { await cleanup(); await app?.close(); await prisma.$disconnect(); });

describe("Phase 5 branch requisition workflow", () => {
  it("TC-P5-01 enforces authentication, permission, branch scope, requestable catalog and supplier secrecy", async () => {
    expect((await request(app.getHttpServer()).get(url(`/requisition/branches/${branchId}/categories`))).status).toBe(401);
    expect((await request(app.getHttpServer()).get(url(`/requisition/branches/${branchId}/categories`)).set("Cookie", otherCookie)).status).toBe(403);
    const categories = await request(app.getHttpServer()).get(url(`/requisition/branches/${branchId}/categories`)).set("Cookie", ownerCookie);
    expect(categories.status).toBe(200);
    expect(categories.body[0].id).toBe(categoryId);
    const items = await request(app.getHttpServer()).get(url(`/requisition/branches/${branchId}/categories/${categoryId}/items`)).set("Cookie", ownerCookie);
    expect(items.status).toBe(200);
    expect(items.body.data[0]).toMatchObject({ branchItemId, sku: `P5-SKU-${suffix}` });
    expect(JSON.stringify(items.body)).not.toMatch(/supplier/i);
    const units = await request(app.getHttpServer()).get(url(`/requisition/branch-items/${branchItemId}/units`)).set("Cookie", ownerCookie);
    expect(units.status).toBe(200);
    expect(units.body).toHaveLength(2);
  });

  it("TC-P5-02 creates a server-numbered draft, enforces CSRF, ownership and line/unit validation", async () => {
    expect((await request(app.getHttpServer()).post(url("/requisitions")).set("Cookie", ownerCookie).send({ branchId })).status).toBe(401);
    const created = await request(app.getHttpServer()).post(url("/requisitions")).set(mutate(ownerCookie, ownerCsrf)).send({ branchId });
    expect(created.status).toBe(201);
    expect(created.body.requestNumber).toMatch(/^REQ-/);
    const requestId = created.body.id as string;
    const resumed = await request(app.getHttpServer()).post(url("/requisitions")).set(mutate(ownerCookie, ownerCsrf)).send({ branchId });
    expect(resumed.status).toBe(201);
    expect(resumed.body.id).toBe(requestId);
    expect((await request(app.getHttpServer()).get(url(`/requisitions/${requestId}`)).set("Cookie", otherCookie)).status).toBe(404);
    expect((await request(app.getHttpServer()).post(url(`/requisitions/${requestId}/items`)).set(mutate(ownerCookie, ownerCsrf)).send({ branchItemId, itemUnitId: otherUnitId, requestedQuantity: "0" })).status).toBe(400);
    const line = await request(app.getHttpServer()).post(url(`/requisitions/${requestId}/items`)).set(mutate(ownerCookie, ownerCsrf)).send({ branchItemId, itemUnitId, requestedQuantity: "2", expectedRowVersion: created.body.rowVersion });
    expect(line.status).toBe(201);
    expect(line.body.items).toHaveLength(1);
    const updated = await request(app.getHttpServer()).post(url(`/requisitions/${requestId}/items`)).set(mutate(ownerCookie, ownerCsrf)).send({ branchItemId, itemUnitId: otherUnitId, requestedQuantity: "3", expectedRowVersion: line.body.rowVersion });
    expect(updated.status).toBe(201);
    expect(updated.body.items).toHaveLength(1);
    expect(updated.body.items[0].requestedQuantity).toBe("3");
    await prisma.requestRecord.update({ where: { id: requestId }, data: { status: RequestStatus.cancelled } });
  });

  it("TC-P5-03 keeps one active cart line under concurrent add and allows exactly one concurrent submit", async () => {
    const created = await request(app.getHttpServer()).post(url("/requisitions")).set(mutate(ownerCookie, ownerCsrf)).send({ branchId });
    const requestId = created.body.id as string;
    const outcomes = await Promise.all([
      request(app.getHttpServer()).post(url(`/requisitions/${requestId}/items`)).set(mutate(ownerCookie, ownerCsrf)).send({ branchItemId, itemUnitId, requestedQuantity: "1", expectedRowVersion: created.body.rowVersion }),
      request(app.getHttpServer()).post(url(`/requisitions/${requestId}/items`)).set(mutate(ownerCookie, ownerCsrf)).send({ branchItemId, itemUnitId, requestedQuantity: "2", expectedRowVersion: created.body.rowVersion }),
    ]);
    expect(outcomes.filter((entry) => entry.status === 201)).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === 409)).toHaveLength(1);
    const draft = await request(app.getHttpServer()).get(url(`/requisitions/${requestId}`)).set("Cookie", ownerCookie);
    expect(draft.body.items.filter((line: { lineStatus: string }) => line.lineStatus === "active")).toHaveLength(1);
    const submitted = await Promise.all([
      request(app.getHttpServer()).post(url(`/requisitions/${requestId}/submit`)).set(mutate(ownerCookie, ownerCsrf)).send({ expectedRowVersion: draft.body.rowVersion }),
      request(app.getHttpServer()).post(url(`/requisitions/${requestId}/submit`)).set(mutate(ownerCookie, ownerCsrf)).send({ expectedRowVersion: draft.body.rowVersion }),
    ]);
    expect(submitted.filter((entry) => entry.status === 201)).toHaveLength(1);
    expect(submitted.filter((entry) => [400, 409].includes(entry.status))).toHaveLength(1);
    expect((await prisma.requestStatusHistory.count({ where: { requestId, fromStatus: RequestStatus.draft, toStatus: RequestStatus.pending_approval } }))).toBe(1);
  });

  it("TC-P5-04 supports returned branch edit, snapshot refresh and atomic resubmission", async () => {
    const created = await request(app.getHttpServer()).post(url("/requisitions")).set(mutate(ownerCookie, ownerCsrf)).send({ branchId });
    const requestId = created.body.id as string;
    const line = await request(app.getHttpServer()).post(url(`/requisitions/${requestId}/items`)).set(mutate(ownerCookie, ownerCsrf)).send({ branchItemId, itemUnitId, requestedQuantity: "1", expectedRowVersion: created.body.rowVersion });
    const first = await request(app.getHttpServer()).post(url(`/requisitions/${requestId}/submit`)).set(mutate(ownerCookie, ownerCsrf)).send({ expectedRowVersion: line.body.rowVersion });
    const initialSubmittedAt = first.body.submittedAt;
    await prisma.requestRecord.update({ where: { id: requestId }, data: { status: RequestStatus.returned } });
    const returned = await request(app.getHttpServer()).get(url(`/requisitions/${requestId}`)).set("Cookie", ownerCookie);
    const edited = await request(app.getHttpServer()).patch(url(`/requisitions/${requestId}/items/${returned.body.items[0].id}`)).set(mutate(ownerCookie, ownerCsrf)).send({ branchItemId, itemUnitId: otherUnitId, requestedQuantity: "4", expectedRowVersion: returned.body.rowVersion });
    expect(edited.status).toBe(200);
    const resubmitted = await request(app.getHttpServer()).post(url(`/requisitions/${requestId}/resubmit`)).set(mutate(ownerCookie, ownerCsrf)).send({ expectedRowVersion: edited.body.rowVersion });
    expect(resubmitted.status).toBe(201);
    expect(resubmitted.body.status).toBe(RequestStatus.pending_approval);
    expect(resubmitted.body.submittedAt).toBe(initialSubmittedAt);
  });
});
