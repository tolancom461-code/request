import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { PrismaClient, RequestStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApplication } from "../apps/api/src/main.js";
import { secureMysqlUrl } from "../apps/api/src/config.js";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const password = "phase8-test-password";
const url = (path: string) => `/api/v1${path}`;
type Login = { cookie: string; csrf: string; userId: string };
type Detail = { id: string; rowVersion: number; status: string; items: Array<{ id: string }> };
let app: NestFastifyApplication;
let suffix = "";
let branchId = "";
let otherBranchId = "";
let branchItemId = "";
let unitId = "";
let employee: Login;
let manager: Login;
let duplicateManager: Login;
let outsideManager: Login;
let warehouse: Login;
let outsideWarehouse: Login;
let admin: Login;
const requestIds: string[] = [];
const userIds: string[] = [];

const headers = (login: Login) => ({ Cookie: login.cookie, Origin: "http://localhost:5173", "X-CSRF-Token": login.csrf });

async function login(username: string): Promise<Login> {
  const response = await request(app.getHttpServer()).post(url("/auth/login")).send({ username, password });
  expect(response.status).toBe(201);
  const me = await request(app.getHttpServer()).get(url("/auth/me")).set("Cookie", String(response.headers["set-cookie"]?.[0]).split(";")[0]);
  return { cookie: String(response.headers["set-cookie"]?.[0]).split(";")[0], csrf: response.body.csrfToken as string, userId: me.body.user.id as string };
}

async function createUser(roleCodes: string[], branchIds: string[]) {
  const user = await prisma.user.create({ data: { username: `p8-${suffix}-${randomUUID().slice(0, 6)}`, email: `p8-${suffix}-${randomUUID().slice(0, 6)}@example.test`, passwordHash: await argon2.hash(password) } });
  userIds.push(user.id);
  for (const roleCode of roleCodes) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  for (const scopedBranchId of branchIds) await prisma.userBranchScope.create({ data: { userId: user.id, branchId: scopedBranchId } });
  return user;
}

async function createPending(): Promise<Detail> {
  const created = await request(app.getHttpServer()).post(url("/requisitions")).set(headers(employee)).send({ branchId });
  expect(created.status).toBe(201);
  const line = await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/items`)).set(headers(employee)).send({ branchItemId, itemUnitId: unitId, requestedQuantity: "2", expectedRowVersion: created.body.rowVersion });
  expect(line.status).toBe(201);
  const submitted = await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/submit`)).set(headers(employee)).send({ expectedRowVersion: line.body.rowVersion });
  expect(submitted.status).toBe(201);
  requestIds.push(created.body.id);
  const detail = await request(app.getHttpServer()).get(url(`/requisitions/${created.body.id}`)).set("Cookie", employee.cookie);
  expect(detail.status).toBe(200);
  return detail.body as Detail;
}

async function approve(pending: Detail) {
  const response = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/approve`)).set(headers(manager)).send({ expectedRowVersion: pending.rowVersion });
  expect(response.status).toBe(201);
  expect(response.body.status).toBe(RequestStatus.sent_to_warehouse);
  return response.body as Detail;
}

async function cleanup() {
  await prisma.notification.deleteMany({ where: { recipientUserId: { in: userIds } } });
  for (const requestId of requestIds) {
    const lines = await prisma.requestItem.findMany({ where: { requestId }, select: { id: true } });
    await prisma.requestApproval.deleteMany({ where: { requestId } });
    await prisma.requestStatusHistory.deleteMany({ where: { requestId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { entityId: { in: lines.map((line) => line.id) } }] } });
    await prisma.requestItem.deleteMany({ where: { requestId } });
    await prisma.requestRecord.deleteMany({ where: { id: requestId } });
  }
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.userBranchScope.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branchItemSupplier.deleteMany({ where: { branchItem: { branchId } } });
  await prisma.branchItem.deleteMany({ where: { branchId } });
  await prisma.itemUnit.deleteMany({ where: { item: { sku: { startsWith: `P8-SKU-${suffix}` } } } });
  await prisma.item.deleteMany({ where: { sku: { startsWith: `P8-SKU-${suffix}` } } });
  await prisma.unit.deleteMany({ where: { code: { startsWith: `P8-U-${suffix}` } } });
  await prisma.supplier.deleteMany({ where: { supplierCode: { startsWith: `P8-SUP-${suffix}` } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: `P8-CAT-${suffix}` } } });
  await prisma.branch.deleteMany({ where: { code: { in: [`P8-BR-${suffix}`, `P8-OTHER-${suffix}`] } } });
}

beforeAll(async () => {
  process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
  await prisma.$connect();
  suffix = randomUUID().slice(0, 8);
  branchId = (await prisma.branch.create({ data: { code: `P8-BR-${suffix}`, nameAr: "فرع إشعارات", nameEn: "Notifications Branch" } })).id;
  otherBranchId = (await prisma.branch.create({ data: { code: `P8-OTHER-${suffix}`, nameAr: "فرع خارج النطاق", nameEn: "Outside Branch" } })).id;
  const category = await prisma.category.create({ data: { code: `P8-CAT-${suffix}`, nameAr: "فئة إشعارات", nameEn: "Notifications Category" } });
  const item = await prisma.item.create({ data: { sku: `P8-SKU-${suffix}`, categoryId: category.id, nameAr: "صنف إشعار", nameEn: "Notification Item", nameUr: "نوٹیفکیشن آئٹم" } });
  const unit = await prisma.unit.create({ data: { code: `P8-U-${suffix}`, nameAr: "قطعة", nameEn: "Piece" } });
  unitId = (await prisma.itemUnit.create({ data: { itemId: item.id, unitId: unit.id, conversionFactorToBase: 1, isBaseUnit: true, activeBaseItemId: item.id } })).id;
  branchItemId = (await prisma.branchItem.create({ data: { branchId, itemId: item.id } })).id;
  const supplier = await prisma.supplier.create({ data: { supplierCode: `P8-SUP-${suffix}`, supplierName: "مورد إشعار" } });
  await prisma.branchItemSupplier.create({ data: { branchItemId, supplierId: supplier.id, isPrimary: true, activePrimaryBranchItemId: branchItemId, effectiveFrom: new Date() } });
  const employees = await Promise.all([
    createUser(["branch_employee"], [branchId]),
    createUser(["branch_manager"], [branchId]),
    createUser(["branch_manager", "system_admin"], [branchId]),
    createUser(["branch_manager"], [otherBranchId]),
    createUser(["warehouse_manager"], [branchId]),
    createUser(["warehouse_manager"], [otherBranchId]),
    createUser(["system_admin"], [branchId]),
  ]);
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  [employee, manager, duplicateManager, outsideManager, warehouse, outsideWarehouse, admin] = await Promise.all(employees.map((entry) => login(entry.username)));
});

afterAll(async () => { await cleanup(); await app?.close(); await prisma.$disconnect(); });

describe("Phase 8 notifications, audit and activity", () => {
  it("TC-P8-01 fans out pending approval only to effective scoped reviewers and deduplicates role membership", async () => {
    const pending = await createPending();
    const recipients = await prisma.notification.findMany({ where: { type: "request.pending_approval", payload: { path: "$.requestId", equals: pending.id } }, select: { recipientUserId: true } });
    const ids = recipients.map((entry) => entry.recipientUserId);
    expect(ids).toContain(manager.userId);
    expect(ids).toContain(duplicateManager.userId);
    expect(ids).toContain(admin.userId);
    expect(ids).not.toContain(outsideManager.userId);
    expect(ids.filter((entry) => entry === duplicateManager.userId)).toHaveLength(1);
  });

  it("TC-P8-02 returns and rejects notify only the request creator in the committed decision transaction", async () => {
    const returned = await createPending();
    const returnResult = await request(app.getHttpServer()).post(url(`/manager/requests/${returned.id}/return`)).set(headers(manager)).send({ expectedRowVersion: returned.rowVersion, reason: "تصحيح مطلوب" });
    expect(returnResult.status).toBe(201);
    const rejected = await createPending();
    const rejectResult = await request(app.getHttpServer()).post(url(`/manager/requests/${rejected.id}/reject`)).set(headers(manager)).send({ expectedRowVersion: rejected.rowVersion, reason: "غير مناسب" });
    expect(rejectResult.status).toBe(201);
    expect(await prisma.notification.count({ where: { recipientUserId: employee.userId, type: { in: ["request.returned", "request.rejected"] } } })).toBeGreaterThanOrEqual(2);
    expect(await prisma.notification.count({ where: { recipientUserId: manager.userId, type: { in: ["request.returned", "request.rejected"] } } })).toBe(0);
  });

  it("TC-P8-03 approves/handoffs and warehouse lifecycle atomically with creator and scoped warehouse notifications", async () => {
    const sent = await approve(await createPending());
    expect(await prisma.notification.count({ where: { recipientUserId: employee.userId, type: "request.approved" } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { recipientUserId: warehouse.userId, type: "warehouse.request_available" } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { recipientUserId: outsideWarehouse.userId, type: "warehouse.request_available" } })).toBe(0);
    const start = await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/start-preparation`)).set(headers(warehouse)).send({ expectedRowVersion: sent.rowVersion });
    const ready = await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/mark-ready`)).set(headers(warehouse)).send({ expectedRowVersion: start.body.rowVersion });
    const dispatched = await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/dispatch`)).set(headers(warehouse)).send({ expectedRowVersion: ready.body.rowVersion });
    const completed = await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/complete`)).set(headers(warehouse)).send({ expectedRowVersion: dispatched.body.rowVersion });
    expect([start.status, ready.status, dispatched.status, completed.status]).toEqual([201, 201, 201, 201]);
    expect(await prisma.notification.count({ where: { recipientUserId: employee.userId, type: { in: ["warehouse.ready", "warehouse.dispatched", "warehouse.completed"] } } })).toBeGreaterThanOrEqual(3);
    const stale = await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/complete`)).set(headers(warehouse)).send({ expectedRowVersion: completed.body.rowVersion });
    expect(stale.status).toBe(409);
    expect(await prisma.notification.count({ where: { recipientUserId: employee.userId, type: "warehouse.completed", payload: { path: "$.requestId", equals: sent.id } } })).toBe(1);
  });

  it("TC-P8-04 enforces recipient ownership, CSRF and idempotent notification reads", async () => {
    const pending = await createPending();
    const owned = await prisma.notification.findFirstOrThrow({ where: { recipientUserId: manager.userId, type: "request.pending_approval", payload: { path: "$.requestId", equals: pending.id } } });
    expect((await request(app.getHttpServer()).get(url("/notifications"))).status).toBe(401);
    expect((await request(app.getHttpServer()).get(url("/notifications")).set("Cookie", manager.cookie)).status).toBe(200);
    expect((await request(app.getHttpServer()).post(url(`/notifications/${owned.id}/read`)).set("Cookie", outsideManager.cookie).send({})).status).toBe(401);
    expect((await request(app.getHttpServer()).post(url(`/notifications/${owned.id}/read`)).set(headers(outsideManager)).send({})).status).toBe(404);
    const first = await request(app.getHttpServer()).post(url(`/notifications/${owned.id}/read`)).set(headers(manager)).send({});
    const second = await request(app.getHttpServer()).post(url(`/notifications/${owned.id}/read`)).set(headers(manager)).send({});
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.readAt).toBe(first.body.readAt);
  });

  it("TC-P8-05 protects audit/activity for admin, redacts secret-like keys and derives only target actor activity", async () => {
    const audit = await prisma.auditLog.create({ data: { actorType: "user", actorUserId: employee.userId, entityType: "request", entityId: randomUUID(), action: "phase8_redaction_probe", beforeData: { token: "hidden", publicValue: "before" }, afterData: { passwordHash: "hidden", publicValue: "after" } } });
    expect((await request(app.getHttpServer()).get(url("/admin/audit-logs"))).status).toBe(401);
    expect((await request(app.getHttpServer()).get(url("/admin/audit-logs")).set("Cookie", manager.cookie)).status).toBe(403);
    const listed = await request(app.getHttpServer()).get(url(`/admin/audit-logs?action=${audit.action}&sort=occurredAt&direction=desc`)).set("Cookie", admin.cookie);
    expect(listed.status).toBe(200);
    const row = listed.body.items.find((entry: { id: string }) => entry.id === audit.id);
    expect(row.beforeData.token).toBe("[REDACTED]");
    expect(row.afterData.passwordHash).toBe("[REDACTED]");
    expect(row.afterData.publicValue).toBe("after");
    const activity = await request(app.getHttpServer()).get(url(`/admin/users/${employee.userId}/activity?action=phase8_redaction_probe`)).set("Cookie", admin.cookie);
    expect(activity.status).toBe(200);
    expect(activity.body.items.every((entry: { actorUserId: string }) => entry.actorUserId === employee.userId)).toBe(true);
    expect((await request(app.getHttpServer()).post(url("/admin/audit-logs")).set(headers(admin)).send({})).status).toBe(404);
  });
});
