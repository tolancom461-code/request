import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { ActorType, ApprovalDecision, PrismaClient, RequestStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApplication } from "../apps/api/src/main.js";
import { secureMysqlUrl } from "../apps/api/src/config.js";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const password = "phase6-test-password";
const url = (path: string) => `/api/v1${path}`;
type Login = { cookie: string; csrf: string };
let app: NestFastifyApplication;
let suffix = "";
let branchId = "";
let otherBranchId = "";
let branchItemId = "";
let baseUnitId = "";
let alternateUnitId = "";
let foreignUnitId = "";
let employeeId = "";
let employeeLogin: Login;
let managerLogin: Login;
let otherManagerLogin: Login;
let warehouseLogin: Login;
const requestIds: string[] = [];
const fixtureUserIds: string[] = [];

const mutationHeaders = (login: Login) => ({ Cookie: login.cookie, Origin: "http://localhost:5173", "X-CSRF-Token": login.csrf });

async function login(username: string): Promise<Login> {
  const response = await request(app.getHttpServer()).post(url("/auth/login")).send({ username, password });
  expect(response.status).toBe(201);
  return { cookie: String(response.headers["set-cookie"]?.[0]).split(";")[0], csrf: response.body.csrfToken as string };
}

async function createUser(roleCode: string, branchIds: string[]) {
  const user = await prisma.user.create({ data: { username: `p6-${roleCode}-${suffix}-${randomUUID().slice(0, 5)}`, email: `p6-${roleCode}-${suffix}-${randomUUID().slice(0, 5)}@example.test`, passwordHash: await argon2.hash(password) } });
  fixtureUserIds.push(user.id);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  for (const scopedBranchId of branchIds) await prisma.userBranchScope.create({ data: { userId: user.id, branchId: scopedBranchId } });
  return user;
}

async function createPendingRequest(quantity = "2") {
  const created = await request(app.getHttpServer()).post(url("/requisitions")).set(mutationHeaders(employeeLogin)).send({ branchId });
  expect(created.status).toBe(201);
  const withLine = await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/items`)).set(mutationHeaders(employeeLogin)).send({ branchItemId, itemUnitId: baseUnitId, requestedQuantity: quantity, expectedRowVersion: created.body.rowVersion });
  expect(withLine.status).toBe(201);
  const submitted = await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/submit`)).set(mutationHeaders(employeeLogin)).send({ expectedRowVersion: withLine.body.rowVersion });
  expect(submitted.status).toBe(201);
  expect(submitted.body.status).toBe(RequestStatus.pending_approval);
  const detail = await request(app.getHttpServer()).get(url(`/requisitions/${created.body.id}`)).set("Cookie", employeeLogin.cookie);
  expect(detail.status).toBe(200);
  requestIds.push(created.body.id);
  return detail.body as { id: string; rowVersion: number; submittedAt: string; items: Array<{ id: string }> };
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
  const users = fixtureUserIds.length ? await prisma.user.findMany({ where: { id: { in: fixtureUserIds } } }) : [];
  for (const user of users) {
    await prisma.notification.deleteMany({ where: { recipientUserId: user.id } });
    await prisma.userBranchScope.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.branchItemSupplier.deleteMany({ where: { branchItem: { branchId } } });
  await prisma.branchItem.deleteMany({ where: { branchId } });
  await prisma.itemUnit.deleteMany({ where: { item: { sku: { startsWith: `P6-SKU-${suffix}` } } } });
  await prisma.item.deleteMany({ where: { sku: { startsWith: `P6-SKU-${suffix}` } } });
  await prisma.unit.deleteMany({ where: { code: { startsWith: `P6-U-${suffix}` } } });
  await prisma.supplier.deleteMany({ where: { supplierCode: { startsWith: `P6-SUP-${suffix}` } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: `P6-CAT-${suffix}` } } });
  await prisma.branch.deleteMany({ where: { code: { in: [`P6-BR-${suffix}`, `P6-OTHER-${suffix}`] } } });
}

beforeAll(async () => {
  process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
  await prisma.$connect();
  suffix = randomUUID().slice(0, 8);
  const branch = await prisma.branch.create({ data: { code: `P6-BR-${suffix}`, nameAr: "فرع مدير", nameEn: "Manager Branch" } });
  const otherBranch = await prisma.branch.create({ data: { code: `P6-OTHER-${suffix}`, nameAr: "فرع خارج النطاق", nameEn: "Out of Scope Branch" } });
  branchId = branch.id;
  otherBranchId = otherBranch.id;
  const category = await prisma.category.create({ data: { code: `P6-CAT-${suffix}`, nameAr: "فئة اعتماد", nameEn: "Approval Category" } });
  const item = await prisma.item.create({ data: { sku: `P6-SKU-${suffix}`, categoryId: category.id, nameAr: "صنف اعتماد", nameEn: "Approval Item", nameUr: "منظوری آئٹم" } });
  const foreignItem = await prisma.item.create({ data: { sku: `P6-SKU-${suffix}-FOREIGN`, categoryId: category.id, nameAr: "صنف أجنبي", nameEn: "Foreign Item", nameUr: "غیر ملکی آئٹم" } });
  const baseUnit = await prisma.unit.create({ data: { code: `P6-U-${suffix}`, nameAr: "قطعة", nameEn: "Piece" } });
  const alternateUnit = await prisma.unit.create({ data: { code: `P6-U-${suffix}-ALT`, nameAr: "علبة", nameEn: "Box" } });
  const foreignUnit = await prisma.unit.create({ data: { code: `P6-U-${suffix}-FOREIGN`, nameAr: "وحدة أجنبية", nameEn: "Foreign Unit" } });
  baseUnitId = (await prisma.itemUnit.create({ data: { itemId: item.id, unitId: baseUnit.id, conversionFactorToBase: 1, isBaseUnit: true, activeBaseItemId: item.id } })).id;
  alternateUnitId = (await prisma.itemUnit.create({ data: { itemId: item.id, unitId: alternateUnit.id, conversionFactorToBase: 12, isBaseUnit: false } })).id;
  foreignUnitId = (await prisma.itemUnit.create({ data: { itemId: foreignItem.id, unitId: foreignUnit.id, conversionFactorToBase: 1, isBaseUnit: true, activeBaseItemId: foreignItem.id } })).id;
  const branchItem = await prisma.branchItem.create({ data: { branchId, itemId: item.id } });
  branchItemId = branchItem.id;
  const supplier = await prisma.supplier.create({ data: { supplierCode: `P6-SUP-${suffix}`, supplierName: "مورد اللقطة" } });
  await prisma.branchItemSupplier.create({ data: { branchItemId, supplierId: supplier.id, isPrimary: true, activePrimaryBranchItemId: branchItemId, effectiveFrom: new Date() } });
  const employee = await createUser("branch_employee", [branchId]);
  employeeId = employee.id;
  const manager = await createUser("branch_manager", [branchId]);
  const otherManager = await createUser("branch_manager", [otherBranchId]);
  const warehouse = await createUser("warehouse_manager", [branchId]);
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  employeeLogin = await login(employee.username);
  managerLogin = await login(manager.username);
  otherManagerLogin = await login(otherManager.username);
  warehouseLogin = await login(warehouse.username);
});

afterAll(async () => { await cleanup(); await app?.close(); await prisma.$disconnect(); });

describe("Phase 6 branch manager approval workflow", () => {
  it("TC-P6-01 enforces authentication, precise permissions, CSRF, server-side pending scope, and guessed-ID protection", async () => {
    const pending = await createPendingRequest();
    expect((await request(app.getHttpServer()).get(url("/manager/requests"))).status).toBe(401);
    expect((await request(app.getHttpServer()).get(url("/manager/requests")).set("Cookie", employeeLogin.cookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).get(url("/manager/requests")).set("Cookie", warehouseLogin.cookie)).status).toBe(403);
    const inbox = await request(app.getHttpServer()).get(url("/manager/requests?page=1&pageSize=10")).set("Cookie", managerLogin.cookie);
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.some((entry: { id: string }) => entry.id === pending.id)).toBe(true);
    expect((await request(app.getHttpServer()).get(url(`/manager/requests/${pending.id}`)).set("Cookie", otherManagerLogin.cookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/approve`)).set("Cookie", managerLogin.cookie).send({ expectedRowVersion: pending.rowVersion })).status).toBe(401);
  });

  it("TC-P6-02 makes pending line edit and logical exclusion atomic, audited, scoped, and row-version safe", async () => {
    const pending = await createPendingRequest();
    const before = await prisma.requestItem.findUniqueOrThrow({ where: { id: pending.items[0].id } });
    const beforeAudit = await prisma.auditLog.count({ where: { entityId: before.id, action: "manager_pending_line_updated" } });
    const foreign = await request(app.getHttpServer()).patch(url(`/manager/requests/${pending.id}/items/${before.id}`)).set(mutationHeaders(managerLogin)).send({ itemUnitId: foreignUnitId, requestedQuantity: "7", expectedRowVersion: pending.rowVersion });
    expect(foreign.status).toBe(400);
    const afterForeign = await prisma.requestItem.findUniqueOrThrow({ where: { id: before.id } });
    expect(afterForeign.requestedQuantity.toString()).toBe(before.requestedQuantity.toString());
    expect(afterForeign.itemUnitIdSnapshot).toBe(before.itemUnitIdSnapshot);
    expect(await prisma.auditLog.count({ where: { entityId: before.id, action: "manager_pending_line_updated" } })).toBe(beforeAudit);
    const edited = await request(app.getHttpServer()).patch(url(`/manager/requests/${pending.id}/items/${before.id}`)).set(mutationHeaders(managerLogin)).send({ itemUnitId: alternateUnitId, requestedQuantity: "3", expectedRowVersion: pending.rowVersion });
    expect(edited.status).toBe(200);
    expect(edited.body.rowVersion).toBe(pending.rowVersion + 1);
    expect(edited.body.items[0]).toMatchObject({ requestedQuantity: "3", itemUnitId: alternateUnitId, lineStatus: "active" });
    expect((await request(app.getHttpServer()).patch(url(`/manager/requests/${pending.id}/items/${before.id}`)).set(mutationHeaders(managerLogin)).send({ itemUnitId: baseUnitId, requestedQuantity: "4", expectedRowVersion: pending.rowVersion })).status).toBe(409);
    expect((await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/items/${before.id}/exclude`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: edited.body.rowVersion, reason: "  " })).status).toBe(400);
    const excluded = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/items/${before.id}/exclude`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: edited.body.rowVersion, reason: "لا يلزم للطلب" });
    expect(excluded.status).toBe(201);
    expect(excluded.body.rowVersion).toBe(edited.body.rowVersion + 1);
    expect((await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/items/${before.id}/exclude`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: edited.body.rowVersion, reason: "قرار قديم" })).status).toBe(409);
    const persisted = await prisma.requestItem.findUniqueOrThrow({ where: { id: before.id } });
    expect(persisted.lineStatus).toBe("excluded");
    expect(persisted.removalReason).toBe("لا يلزم للطلب");
    expect((await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/approve`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: excluded.body.rowVersion })).status).toBe(400);
    expect((await prisma.requestRecord.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(RequestStatus.pending_approval);
    expect(await prisma.requestApproval.count({ where: { requestId: pending.id } })).toBe(0);
  });

  it("TC-P6-03 returns with mandatory reason, preserves submittedAt, and remains compatible with P-005-C1 edit/resubmit before approval handoff", async () => {
    const pending = await createPendingRequest();
    const originalSubmittedAt = pending.submittedAt;
    expect((await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/return`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: pending.rowVersion, reason: "" })).status).toBe(400);
    const returned = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/return`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: pending.rowVersion, reason: "يرجى مراجعة الكمية" });
    expect(returned.status).toBe(201);
    expect(returned.body).toMatchObject({ status: RequestStatus.returned, submittedAt: originalSubmittedAt, rowVersion: pending.rowVersion + 1 });
    expect(returned.body.approvals.map((entry: { decision: string }) => entry.decision)).toContain(ApprovalDecision.returned);
    expect(await prisma.requestStatusHistory.count({ where: { requestId: pending.id, fromStatus: RequestStatus.pending_approval, toStatus: RequestStatus.returned, actorType: ActorType.user } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: pending.id, action: "manager_request_returned" } })).toBe(1);
    const employeeView = await request(app.getHttpServer()).get(url(`/requisitions/${pending.id}`)).set("Cookie", employeeLogin.cookie);
    const changed = await request(app.getHttpServer()).patch(url(`/requisitions/${pending.id}/items/${employeeView.body.items[0].id}`)).set(mutationHeaders(employeeLogin)).send({ branchItemId, itemUnitId: alternateUnitId, requestedQuantity: "4", expectedRowVersion: employeeView.body.rowVersion });
    expect(changed.status).toBe(200);
    const resubmitted = await request(app.getHttpServer()).post(url(`/requisitions/${pending.id}/resubmit`)).set(mutationHeaders(employeeLogin)).send({ expectedRowVersion: changed.body.rowVersion });
    expect(resubmitted.status).toBe(201);
    expect(resubmitted.body).toMatchObject({ status: RequestStatus.pending_approval, submittedAt: originalSubmittedAt });
    const inboxAfterResubmit = await request(app.getHttpServer()).get(url("/manager/requests?page=1&pageSize=30")).set("Cookie", managerLogin.cookie);
    expect(inboxAfterResubmit.body.data.some((entry: { id: string }) => entry.id === pending.id)).toBe(true);
    const beforeApproval = await prisma.requestItem.findUniqueOrThrow({ where: { id: employeeView.body.items[0].id } });
    const approved = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/approve`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: resubmitted.body.rowVersion, comment: "موافق" });
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ status: RequestStatus.sent_to_warehouse, approvedAt: expect.any(String), warehouseAvailableAt: expect.any(String) });
    const afterApproval = await prisma.requestItem.findUniqueOrThrow({ where: { id: beforeApproval.id } });
    expect(afterApproval.supplierIdSnapshot).toBe(beforeApproval.supplierIdSnapshot);
    const history = await prisma.requestStatusHistory.findMany({ where: { requestId: pending.id }, orderBy: { occurredAt: "asc" } });
    expect(history.some((entry) => entry.fromStatus === RequestStatus.pending_approval && entry.toStatus === RequestStatus.approved && entry.actorType === ActorType.user)).toBe(true);
    expect(history.some((entry) => entry.fromStatus === RequestStatus.approved && entry.toStatus === RequestStatus.sent_to_warehouse && entry.actorType === ActorType.system && entry.actorUserId === null)).toBe(true);
    expect(await prisma.requestApproval.count({ where: { requestId: pending.id, decision: ApprovalDecision.approved } })).toBe(1);
  });

  it("TC-P6-04 rejects with a mandatory reason and keeps the rejected request terminal for normal employee and manager flows", async () => {
    const pending = await createPendingRequest();
    expect((await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/reject`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: pending.rowVersion, reason: "" })).status).toBe(400);
    const rejected = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/reject`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: pending.rowVersion, reason: "الطلب غير مناسب" });
    expect(rejected.status).toBe(201);
    expect(rejected.body.status).toBe(RequestStatus.rejected);
    expect(rejected.body.approvals.map((entry: { decision: string }) => entry.decision)).toContain(ApprovalDecision.rejected);
    expect(await prisma.requestStatusHistory.count({ where: { requestId: pending.id, fromStatus: RequestStatus.pending_approval, toStatus: RequestStatus.rejected, actorType: ActorType.user } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: pending.id, action: "manager_request_rejected" } })).toBe(1);
    expect((await request(app.getHttpServer()).post(url(`/requisitions/${pending.id}/resubmit`)).set(mutationHeaders(employeeLogin)).send({ expectedRowVersion: rejected.body.rowVersion })).status).toBe(400);
    expect((await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/approve`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: rejected.body.rowVersion })).status).toBe(409);
    expect((await request(app.getHttpServer()).patch(url(`/manager/requests/${pending.id}/items/${pending.items[0].id}`)).set(mutationHeaders(managerLogin)).send({ itemUnitId: baseUnitId, requestedQuantity: "9", expectedRowVersion: rejected.body.rowVersion })).status).toBe(409);
  });

  it("TC-P6-05 permits exactly one concurrent manager decision and leaves one decision/history trail", async () => {
    const pending = await createPendingRequest();
    const outcomes = await Promise.all([
      request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/approve`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: pending.rowVersion }),
      request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/return`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: pending.rowVersion, reason: "سباق عودة" }),
      request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/reject`)).set(mutationHeaders(managerLogin)).send({ expectedRowVersion: pending.rowVersion, reason: "سباق رفض" }),
    ]);
    expect(outcomes.filter((entry) => entry.status === 201)).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === 409)).toHaveLength(2);
    expect(await prisma.requestApproval.count({ where: { requestId: pending.id } })).toBe(1);
    const finalRequest = await prisma.requestRecord.findUniqueOrThrow({ where: { id: pending.id } });
    expect([RequestStatus.returned, RequestStatus.rejected, RequestStatus.sent_to_warehouse]).toContain(finalRequest.status);
    expect(finalRequest.createdByUserId).toBe(employeeId);
  });
});
