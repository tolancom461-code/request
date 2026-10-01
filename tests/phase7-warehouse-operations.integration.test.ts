import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { ActorType, PrismaClient, RequestStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApplication } from "../apps/api/src/main.js";
import { secureMysqlUrl } from "../apps/api/src/config.js";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const password = "phase7-test-password";
const url = (path: string) => `/api/v1${path}`;
type Login = { cookie: string; csrf: string };
type RequestDetail = { id: string; rowVersion: number; submittedAt: string; items: Array<{ id: string; branchItemId: string; itemId: string; supplierSnapshot: { id: string } }> };
let app: NestFastifyApplication;
let suffix = "";
let branchId = "";
let otherBranchId = "";
let employeeLogin: Login;
let managerLogin: Login;
let warehouseLogin: Login;
let otherWarehouseLogin: Login;
let branchItemAId = "";
let branchItemBId = "";
let alternateUnitAId = "";
let baseUnitBId = "";
let originalSupplierId = "";
const requestIds: string[] = [];

const mutationHeaders = (login: Login) => ({ Cookie: login.cookie, Origin: "http://localhost:5173", "X-CSRF-Token": login.csrf });

async function login(username: string): Promise<Login> {
  const response = await request(app.getHttpServer()).post(url("/auth/login")).send({ username, password });
  expect(response.status).toBe(201);
  return { cookie: String(response.headers["set-cookie"]?.[0]).split(";")[0], csrf: response.body.csrfToken as string };
}

async function createUser(roleCode: string, branchIds: string[]) {
  const user = await prisma.user.create({ data: { username: `p7-${roleCode}-${suffix}-${randomUUID().slice(0, 5)}`, email: `p7-${roleCode}-${suffix}-${randomUUID().slice(0, 5)}@example.test`, passwordHash: await argon2.hash(password) } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  for (const scopedBranchId of branchIds) await prisma.userBranchScope.create({ data: { userId: user.id, branchId: scopedBranchId } });
  return user;
}

async function createPending(withSecondLine = false) {
  const created = await request(app.getHttpServer()).post(url("/requisitions")).set(mutationHeaders(employeeLogin)).send({ branchId });
  expect(created.status).toBe(201);
  const first = await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/items`)).set(mutationHeaders(employeeLogin)).send({ branchItemId: branchItemAId, itemUnitId: alternateUnitAId, requestedQuantity: "2", expectedRowVersion: created.body.rowVersion });
  expect(first.status).toBe(201);
  const second = withSecondLine
    ? await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/items`)).set(mutationHeaders(employeeLogin)).send({ branchItemId: branchItemBId, itemUnitId: baseUnitBId, requestedQuantity: "7", expectedRowVersion: first.body.rowVersion })
    : first;
  if (withSecondLine) expect(second.status).toBe(201);
  const submitted = await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/submit`)).set(mutationHeaders(employeeLogin)).send({ expectedRowVersion: second.body.rowVersion });
  expect(submitted.status).toBe(201);
  expect(submitted.body.status).toBe(RequestStatus.pending_approval);
  const detail = await request(app.getHttpServer()).get(url(`/requisitions/${created.body.id}`)).set("Cookie", employeeLogin.cookie);
  expect(detail.status).toBe(200);
  requestIds.push(created.body.id);
  return detail.body as RequestDetail;
}

async function approveToWarehouse(pending: RequestDetail, excludeSecond = false) {
  let rowVersion = pending.rowVersion;
  if (excludeSecond) {
    const second = pending.items.find((line) => line.branchItemId === branchItemBId);
    expect(second).toBeTruthy();
    const excluded = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/items/${second!.id}/exclude`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: rowVersion, reason: "مستبعد من التشغيل" });
    expect(excluded.status).toBe(201);
    rowVersion = excluded.body.rowVersion;
  }
  const approved = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/approve`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: rowVersion });
  expect(approved.status).toBe(201);
  expect(approved.body).toMatchObject({ status: RequestStatus.sent_to_warehouse, warehouseAvailableAt: expect.any(String) });
  return approved.body as { id: string; requestNumber: string; rowVersion: number; warehouseAvailableAt: string; items: Array<{ id: string; lineStatus: string; supplierSnapshot: { id: string } }> };
}

async function cleanup() {
  for (const requestId of requestIds) {
    const lines = await prisma.requestItem.findMany({ where: { requestId }, select: { id: true } });
    await prisma.requestApproval.deleteMany({ where: { requestId } });
    await prisma.requestStatusHistory.deleteMany({ where: { requestId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: requestId }, { entityId: { in: lines.map((line) => line.id) } }] } });
    await prisma.requestItem.deleteMany({ where: { requestId } });
    await prisma.requestRecord.deleteMany({ where: { id: requestId } });
  }
  const users = await prisma.user.findMany({ where: { email: { contains: `p7-` } } });
  for (const user of users) {
    await prisma.notification.deleteMany({ where: { recipientUserId: user.id } });
    await prisma.userBranchScope.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.branchItemSupplier.deleteMany({ where: { branchItem: { branchId } } });
  await prisma.branchItem.deleteMany({ where: { branchId } });
  await prisma.itemUnit.deleteMany({ where: { item: { sku: { startsWith: `P7-SKU-${suffix}` } } } });
  await prisma.item.deleteMany({ where: { sku: { startsWith: `P7-SKU-${suffix}` } } });
  await prisma.unit.deleteMany({ where: { code: { startsWith: `P7-U-${suffix}` } } });
  await prisma.supplier.deleteMany({ where: { supplierCode: { startsWith: `P7-SUP-${suffix}` } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: `P7-CAT-${suffix}` } } });
  await prisma.branch.deleteMany({ where: { code: { in: [`P7-BR-${suffix}`, `P7-OTHER-${suffix}`] } } });
}

beforeAll(async () => {
  process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
  await prisma.$connect();
  suffix = randomUUID().slice(0, 8);
  const branch = await prisma.branch.create({ data: { code: `P7-BR-${suffix}`, nameAr: "فرع المستودع", nameEn: "Warehouse Branch" } });
  const otherBranch = await prisma.branch.create({ data: { code: `P7-OTHER-${suffix}`, nameAr: "فرع خارج نطاق المستودع", nameEn: "Out of Scope Warehouse Branch" } });
  branchId = branch.id;
  otherBranchId = otherBranch.id;
  const category = await prisma.category.create({ data: { code: `P7-CAT-${suffix}`, nameAr: "فئة مستودع", nameEn: "Warehouse Category" } });
  const itemA = await prisma.item.create({ data: { sku: `P7-SKU-${suffix}-A`, categoryId: category.id, nameAr: "صنف مستودع", nameEn: "Warehouse Item", nameUr: "گودام آئٹم" } });
  const itemB = await prisma.item.create({ data: { sku: `P7-SKU-${suffix}-B`, categoryId: category.id, nameAr: "صنف مستبعد", nameEn: "Excluded Item", nameUr: "خارج شدہ آئٹم" } });
  const piece = await prisma.unit.create({ data: { code: `P7-U-${suffix}-PC`, nameAr: "قطعة", nameEn: "Piece" } });
  const box = await prisma.unit.create({ data: { code: `P7-U-${suffix}-BOX`, nameAr: "علبة", nameEn: "Box" } });
  await prisma.itemUnit.create({ data: { itemId: itemA.id, unitId: piece.id, conversionFactorToBase: 1, isBaseUnit: true, activeBaseItemId: itemA.id } });
  alternateUnitAId = (await prisma.itemUnit.create({ data: { itemId: itemA.id, unitId: box.id, conversionFactorToBase: 12, isBaseUnit: false } })).id;
  baseUnitBId = (await prisma.itemUnit.create({ data: { itemId: itemB.id, unitId: piece.id, conversionFactorToBase: 1, isBaseUnit: true, activeBaseItemId: itemB.id } })).id;
  branchItemAId = (await prisma.branchItem.create({ data: { branchId, itemId: itemA.id } })).id;
  branchItemBId = (await prisma.branchItem.create({ data: { branchId, itemId: itemB.id } })).id;
  const originalSupplier = await prisma.supplier.create({ data: { supplierCode: `P7-SUP-${suffix}-ORIGINAL`, supplierName: "مورد اللقطة الأصلي" } });
  originalSupplierId = originalSupplier.id;
  await prisma.branchItemSupplier.create({ data: { branchItemId: branchItemAId, supplierId: originalSupplier.id, isPrimary: true, activePrimaryBranchItemId: branchItemAId, effectiveFrom: new Date() } });
  await prisma.branchItemSupplier.create({ data: { branchItemId: branchItemBId, supplierId: originalSupplier.id, isPrimary: true, activePrimaryBranchItemId: branchItemBId, effectiveFrom: new Date() } });
  const employee = await createUser("branch_employee", [branchId]);
  const manager = await createUser("branch_manager", [branchId]);
  const warehouse = await createUser("warehouse_manager", [branchId]);
  const otherWarehouse = await createUser("warehouse_manager", [otherBranchId]);
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  employeeLogin = await login(employee.username);
  managerLogin = await login(manager.username);
  warehouseLogin = await login(warehouse.username);
  otherWarehouseLogin = await login(otherWarehouse.username);
});

afterAll(async () => { await cleanup(); await app?.close(); await prisma.$disconnect(); });

describe("Phase 7 warehouse operations", () => {
  it("TC-P7-01 enforces warehouse.process, persisted branch scope, CSRF, and Phase 6 automatic handoff", async () => {
    const pending = await createPending();
    const sent = await approveToWarehouse(pending);
    expect((await request(app.getHttpServer()).get(url("/warehouse/requests"))).status).toBe(401);
    expect((await request(app.getHttpServer()).get(url("/warehouse/requests")).set("Cookie", employeeLogin.cookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).get(url("/warehouse/requests")).set("Cookie", managerLogin.cookie)).status).toBe(403);
    const queue = await request(app.getHttpServer()).get(url("/warehouse/requests?page=1&pageSize=20")).set("Cookie", warehouseLogin.cookie);
    expect(queue.status).toBe(200);
    expect(queue.body.data.some((entry: { id: string; status: string; warehouseAvailableAt: string | null }) => entry.id === sent.id && entry.status === RequestStatus.sent_to_warehouse && entry.warehouseAvailableAt)).toBe(true);
    expect((await request(app.getHttpServer()).get(url(`/warehouse/requests/${sent.id}`)).set("Cookie", otherWarehouseLogin.cookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/start-preparation`)).set("Cookie", warehouseLogin.cookie).send({ expectedRowVersion: sent.rowVersion })).status).toBe(401);
  });

  it("TC-P7-02 groups active frozen snapshots by request, branch, supplier and item while excluding manager-excluded lines", async () => {
    const pending = await createPending(true);
    const sent = await approveToWarehouse(pending, true);
    const oldRelation = await prisma.branchItemSupplier.findFirstOrThrow({ where: { branchItemId: branchItemAId, supplierId: originalSupplierId } });
    const replacement = await prisma.supplier.create({ data: { supplierCode: `P7-SUP-${suffix}-CURRENT`, supplierName: "مورد حالي بعد اللقطة" } });
    await prisma.branchItemSupplier.update({ where: { id: oldRelation.id }, data: { isPrimary: false, activePrimaryBranchItemId: null } });
    await prisma.branchItemSupplier.create({ data: { branchItemId: branchItemAId, supplierId: replacement.id, isPrimary: true, activePrimaryBranchItemId: branchItemAId, effectiveFrom: new Date() } });
    for (const groupBy of ["request", "branch", "supplier", "item"]) {
      const grouped = await request(app.getHttpServer()).get(url(`/warehouse/requests/groups?groupBy=${groupBy}&status=sent_to_warehouse&search=${encodeURIComponent(sent.requestNumber)}`)).set("Cookie", warehouseLogin.cookie);
      expect(grouped.status).toBe(200);
      expect(grouped.body.data.length).toBeGreaterThan(0);
    }
    const supplierGroups = await request(app.getHttpServer()).get(url(`/warehouse/requests/groups?groupBy=supplier&status=sent_to_warehouse&search=${encodeURIComponent(sent.requestNumber)}`)).set("Cookie", warehouseLogin.cookie);
    const originalGroup = supplierGroups.body.data.find((entry: { key: string }) => entry.key === originalSupplierId);
    expect(originalGroup).toBeTruthy();
    expect(originalGroup.label.code).toBe(`P7-SUP-${suffix}-ORIGINAL`);
    expect(originalGroup.totalBaseQuantity).toBe("24");
    expect(originalGroup.lines).toHaveLength(1);
    expect(originalGroup.lines[0].requestId).toBe(sent.id);
    expect((await request(app.getHttpServer()).get(url(`/warehouse/requests/groups?groupBy=supplier&branchId=${otherBranchId}`)).set("Cookie", warehouseLogin.cookie)).status).toBe(403);
  });

  it("TC-P7-03 executes all strict warehouse transitions atomically with history, audit, one version bump, and terminal completed behavior", async () => {
    const sent = await approveToWarehouse(await createPending());
    const start = await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/start-preparation`)).set(mutationHeaders(warehouseLogin)).send({ expectedRowVersion: sent.rowVersion });
    expect(start.status).toBe(201);
    expect(start.body).toMatchObject({ status: RequestStatus.preparing, rowVersion: sent.rowVersion + 1 });
    expect((await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/dispatch`)).set(mutationHeaders(warehouseLogin)).send({ expectedRowVersion: start.body.rowVersion })).status).toBe(409);
    expect((await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/start-preparation`)).set(mutationHeaders(warehouseLogin)).send({ expectedRowVersion: sent.rowVersion })).status).toBe(409);
    const ready = await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/mark-ready`)).set(mutationHeaders(warehouseLogin)).send({ expectedRowVersion: start.body.rowVersion });
    expect(ready.status).toBe(201);
    const dispatched = await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/dispatch`)).set(mutationHeaders(warehouseLogin)).send({ expectedRowVersion: ready.body.rowVersion });
    expect(dispatched.status).toBe(201);
    const completed = await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/complete`)).set(mutationHeaders(warehouseLogin)).send({ expectedRowVersion: dispatched.body.rowVersion });
    expect(completed.status).toBe(201);
    expect(completed.body.status).toBe(RequestStatus.completed);
    expect((await request(app.getHttpServer()).post(url(`/warehouse/requests/${sent.id}/start-preparation`)).set(mutationHeaders(warehouseLogin)).send({ expectedRowVersion: completed.body.rowVersion })).status).toBe(409);
    const history = await prisma.requestStatusHistory.findMany({ where: { requestId: sent.id, actorType: ActorType.user }, orderBy: { occurredAt: "asc" } });
    expect(history.slice(-4).map((entry) => `${entry.fromStatus}->${entry.toStatus}`)).toEqual(["sent_to_warehouse->preparing", "preparing->ready", "ready->dispatched", "dispatched->completed"]);
    expect(await prisma.auditLog.count({ where: { entityId: sent.id, action: { in: ["warehouse_preparation_started", "warehouse_request_marked_ready", "warehouse_request_dispatched", "warehouse_request_completed"] } } })).toBe(4);
  });

  it("TC-P7-04 accepts exactly one concurrent start and leaves no partial mutation when operational lines are invalid", async () => {
    const concurrent = await approveToWarehouse(await createPending());
    const outcomes = await Promise.all([
      request(app.getHttpServer()).post(url(`/warehouse/requests/${concurrent.id}/start-preparation`)).set(mutationHeaders(warehouseLogin)).send({ expectedRowVersion: concurrent.rowVersion }),
      request(app.getHttpServer()).post(url(`/warehouse/requests/${concurrent.id}/start-preparation`)).set(mutationHeaders(warehouseLogin)).send({ expectedRowVersion: concurrent.rowVersion }),
    ]);
    expect(outcomes.filter((entry) => entry.status === 201)).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === 409)).toHaveLength(1);
    expect(await prisma.requestStatusHistory.count({ where: { requestId: concurrent.id, fromStatus: RequestStatus.sent_to_warehouse, toStatus: RequestStatus.preparing } })).toBe(1);
    const invalid = await approveToWarehouse(await createPending());
    const invalidLine = await prisma.requestItem.findFirstOrThrow({ where: { requestId: invalid.id, lineStatus: "active" } });
    await prisma.requestItem.update({ where: { id: invalidLine.id }, data: { baseQuantitySnapshot: 0 } });
    const before = await prisma.requestRecord.findUniqueOrThrow({ where: { id: invalid.id } });
    const beforeHistory = await prisma.requestStatusHistory.count({ where: { requestId: invalid.id } });
    const beforeAudit = await prisma.auditLog.count({ where: { entityId: invalid.id, action: "warehouse_preparation_started" } });
    expect((await request(app.getHttpServer()).post(url(`/warehouse/requests/${invalid.id}/start-preparation`)).set(mutationHeaders(warehouseLogin)).send({ expectedRowVersion: invalid.rowVersion })).status).toBe(400);
    const after = await prisma.requestRecord.findUniqueOrThrow({ where: { id: invalid.id } });
    expect(after).toMatchObject({ status: before.status, rowVersion: before.rowVersion });
    expect(await prisma.requestStatusHistory.count({ where: { requestId: invalid.id } })).toBe(beforeHistory);
    expect(await prisma.auditLog.count({ where: { entityId: invalid.id, action: "warehouse_preparation_started" } })).toBe(beforeAudit);
  });
});
