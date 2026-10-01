import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { PrismaClient, RequestStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApplication } from "../apps/api/src/main.js";
import { secureMysqlUrl } from "../apps/api/src/config.js";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const password = "phase9-test-password";
const url = (path: string) => `/api/v1${path}`;
type Login = { cookie: string; csrf: string; userId: string };
type Detail = { id: string; rowVersion: number; status: string };
let app: NestFastifyApplication;
let suffix = "";
let branchId = "";
let otherBranchId = "";
let branchItemId = "";
let otherBranchItemId = "";
let unitId = "";
let supplierId = "";
let employee: Login;
let otherEmployee: Login;
let manager: Login;
let otherManager: Login;
let warehouse: Login;
let admin: Login;
let returningManager: Login;
let approvingManager: Login;
let rejectingManager: Login;
let returningManagerUsername = "";
let approvingManagerUsername = "";
let rejectingManagerUsername = "";
const requestIds: string[] = [];
const userIds: string[] = [];

const headers = (login: Login) => ({ Cookie: login.cookie, Origin: "http://localhost:5173", "X-CSRF-Token": login.csrf });
async function login(username: string): Promise<Login> {
  const response = await request(app.getHttpServer()).post(url("/auth/login")).send({ username, password });
  expect(response.status).toBe(201);
  const cookie = String(response.headers["set-cookie"]?.[0]).split(";")[0];
  const me = await request(app.getHttpServer()).get(url("/auth/me")).set("Cookie", cookie);
  return { cookie, csrf: response.body.csrfToken as string, userId: me.body.user.id as string };
}
async function createUser(roleCodes: string[], branchIds: string[], username = `p9-${suffix}-${randomUUID().slice(0, 6)}`) {
  const user = await prisma.user.create({ data: { username, email: `${randomUUID()}@example.test`, passwordHash: await argon2.hash(password) } });
  userIds.push(user.id);
  for (const roleCode of roleCodes) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  for (const scopedBranchId of branchIds) await prisma.userBranchScope.create({ data: { userId: user.id, branchId: scopedBranchId } });
  return user;
}
async function submit(loginUser: Login, scopedBranchId: string, scopedBranchItemId: string): Promise<Detail> {
  const created = await request(app.getHttpServer()).post(url("/requisitions")).set(headers(loginUser)).send({ branchId: scopedBranchId });
  expect(created.status).toBe(201);
  const line = await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/items`)).set(headers(loginUser)).send({ branchItemId: scopedBranchItemId, itemUnitId: unitId, requestedQuantity: "3", expectedRowVersion: created.body.rowVersion });
  expect(line.status).toBe(201);
  const submitted = await request(app.getHttpServer()).post(url(`/requisitions/${created.body.id}/submit`)).set(headers(loginUser)).send({ expectedRowVersion: line.body.rowVersion });
  expect(submitted.status).toBe(201);
  requestIds.push(created.body.id);
  const detail = await request(app.getHttpServer()).get(url(`/requisitions/${created.body.id}`)).set("Cookie", loginUser.cookie);
  expect(detail.status).toBe(200);
  return detail.body as Detail;
}
async function progressToCompleted(pending: Detail) {
  const approved = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/approve`)).set(headers(manager)).send({ expectedRowVersion: pending.rowVersion });
  expect(approved.status).toBe(201);
  expect(approved.body.status).toBe(RequestStatus.sent_to_warehouse);
  const preparing = await request(app.getHttpServer()).post(url(`/warehouse/requests/${pending.id}/start-preparation`)).set(headers(warehouse)).send({ expectedRowVersion: approved.body.rowVersion });
  const ready = await request(app.getHttpServer()).post(url(`/warehouse/requests/${pending.id}/mark-ready`)).set(headers(warehouse)).send({ expectedRowVersion: preparing.body.rowVersion });
  const dispatched = await request(app.getHttpServer()).post(url(`/warehouse/requests/${pending.id}/dispatch`)).set(headers(warehouse)).send({ expectedRowVersion: ready.body.rowVersion });
  const completed = await request(app.getHttpServer()).post(url(`/warehouse/requests/${pending.id}/complete`)).set(headers(warehouse)).send({ expectedRowVersion: dispatched.body.rowVersion });
  expect([preparing.status, ready.status, dispatched.status, completed.status]).toEqual([201, 201, 201, 201]);
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
  await prisma.branchItemSupplier.deleteMany({ where: { branchItem: { branchId: { in: [branchId, otherBranchId] } } } });
  await prisma.branchItem.deleteMany({ where: { branchId: { in: [branchId, otherBranchId] } } });
  await prisma.itemUnit.deleteMany({ where: { item: { sku: { startsWith: `P9-SKU-${suffix}` } } } });
  await prisma.item.deleteMany({ where: { sku: { startsWith: `P9-SKU-${suffix}` } } });
  await prisma.unit.deleteMany({ where: { code: { startsWith: `P9-U-${suffix}` } } });
  await prisma.supplier.deleteMany({ where: { id: supplierId } });
  await prisma.category.deleteMany({ where: { code: { startsWith: `P9-CAT-${suffix}` } } });
  await prisma.branch.deleteMany({ where: { id: { in: [branchId, otherBranchId] } } });
}

beforeAll(async () => {
  process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
  await prisma.$connect();
  suffix = randomUUID().slice(0, 8);
  branchId = (await prisma.branch.create({ data: { code: `P9-BR-${suffix}`, nameAr: "فرع التقارير", nameEn: "Reports Branch" } })).id;
  otherBranchId = (await prisma.branch.create({ data: { code: `P9-OTHER-${suffix}`, nameAr: "فرع آخر", nameEn: "Other Branch" } })).id;
  const category = await prisma.category.create({ data: { code: `P9-CAT-${suffix}`, nameAr: "فئة التقارير", nameEn: "Reports Category" } });
  const item = await prisma.item.create({ data: { sku: `P9-SKU-${suffix}`, categoryId: category.id, nameAr: "صنف لقطة", nameEn: "Snapshot Item", nameUr: "اسنیپ شاٹ آئٹم" } });
  const unit = await prisma.unit.create({ data: { code: `P9-U-${suffix}`, nameAr: "قطعة", nameEn: "Piece" } });
  unitId = (await prisma.itemUnit.create({ data: { itemId: item.id, unitId: unit.id, conversionFactorToBase: 2, isBaseUnit: true, activeBaseItemId: item.id } })).id;
  branchItemId = (await prisma.branchItem.create({ data: { branchId, itemId: item.id } })).id;
  otherBranchItemId = (await prisma.branchItem.create({ data: { branchId: otherBranchId, itemId: item.id } })).id;
  supplierId = (await prisma.supplier.create({ data: { supplierCode: `P9-SUP-${suffix}`, supplierName: "Snapshot Supplier" } })).id;
  await prisma.branchItemSupplier.create({ data: { branchItemId, supplierId, isPrimary: true, activePrimaryBranchItemId: branchItemId, effectiveFrom: new Date() } });
  await prisma.branchItemSupplier.create({ data: { branchItemId: otherBranchItemId, supplierId, isPrimary: true, effectiveFrom: new Date() } });
  const users = await Promise.all([
    createUser(["branch_employee"], [branchId], `=P9Creator-${suffix}`),
    createUser(["branch_employee"], [otherBranchId]),
    createUser(["branch_manager"], [branchId]),
    createUser(["branch_manager"], [otherBranchId]),
    createUser(["warehouse_manager"], [branchId]),
    createUser(["system_admin"], [branchId]),
    createUser(["branch_manager"], [branchId], `p9-return-${suffix}`),
    createUser(["branch_manager"], [branchId], `p9-approve-${suffix}`),
    createUser(["branch_manager"], [branchId], `p9-reject-${suffix}`),
  ]);
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  [employee, otherEmployee, manager, otherManager, warehouse, admin, returningManager, approvingManager, rejectingManager] = await Promise.all(users.map((user) => login(user.username)));
  [, , , , , , { username: returningManagerUsername }, { username: approvingManagerUsername }, { username: rejectingManagerUsername }] = users;
});

afterAll(async () => { await cleanup(); await app?.close(); await prisma.$disconnect(); });

describe("Phase 9 reports and dashboards", () => {
  it("TC-P9-01 enforces authentication, report permissions, and server-side branch scope", async () => {
    const own = await submit(employee, branchId, branchItemId);
    await submit(otherEmployee, otherBranchId, otherBranchItemId);
    expect((await request(app.getHttpServer()).get(url("/reports/dashboard"))).status).toBe(401);
    expect((await request(app.getHttpServer()).get(url("/reports/dashboard")).set("Cookie", employee.cookie)).status).toBe(403);
    const scoped = await request(app.getHttpServer()).get(url("/reports/requests?pageSize=50")).set("Cookie", manager.cookie);
    expect(scoped.status).toBe(200);
    expect(scoped.body.data.map((row: { id: string }) => row.id)).toContain(own.id);
    expect(scoped.body.data.every((row: { branch: { id: string } }) => row.branch.id === branchId)).toBe(true);
    expect((await request(app.getHttpServer()).get(url(`/reports/requests?branchId=${otherBranchId}`)).set("Cookie", manager.cookie)).status).toBe(403);
    const all = await request(app.getHttpServer()).get(url("/reports/requests?pageSize=50")).set("Cookie", admin.cookie);
    expect(all.status).toBe(200);
    expect(all.body.data.some((row: { branch: { id: string } }) => row.branch.id === otherBranchId)).toBe(true);
  });

  it("TC-P9-02 reports frozen supplier and base quantity snapshots after current master data changes", async () => {
    const pending = await submit(employee, branchId, branchItemId);
    await prisma.supplier.update({ where: { id: supplierId }, data: { supplierName: "Mutated Current Supplier" } });
    const suppliers = await request(app.getHttpServer()).get(url("/reports/suppliers")).set("Cookie", manager.cookie);
    expect(suppliers.status).toBe(200);
    const snapshot = suppliers.body.data.find((row: { supplierSnapshot: { code: string } }) => row.supplierSnapshot.code === `P9-SUP-${suffix}`);
    expect(snapshot.supplierSnapshot.name).toBe("Snapshot Supplier");
    const items = await request(app.getHttpServer()).get(url("/reports/items")).set("Cookie", manager.cookie);
    expect(items.status).toBe(200);
    expect(Number(items.body.data.find((row: { item: { sku: string } }) => row.item.sku === `P9-SKU-${suffix}`).totalBaseQuantity)).toBeGreaterThanOrEqual(6);
    expect(pending.status).toBe(RequestStatus.pending_approval);
  });

  it("TC-P9-03 derives dashboard, lifecycle, approval, and warehouse values from committed transitions", async () => {
    await progressToCompleted(await submit(employee, branchId, branchItemId));
    const dashboard = await request(app.getHttpServer()).get(url("/reports/dashboard")).set("Cookie", manager.cookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.kpis.submittedRequests).toBeGreaterThanOrEqual(3);
    expect(Number(dashboard.body.kpis.totalActiveRequestedBaseQuantity)).toBeGreaterThanOrEqual(18);
    const lifecycle = await request(app.getHttpServer()).get(url("/reports/status-lifecycle")).set("Cookie", manager.cookie);
    expect(lifecycle.status).toBe(200);
    expect(lifecycle.body.transitionEventCounts.completed).toBeGreaterThanOrEqual(1);
    const approvals = await request(app.getHttpServer()).get(url("/reports/approvals")).set("Cookie", manager.cookie);
    expect(approvals.status).toBe(200);
    expect(approvals.body.decisionCounts.approved).toBeGreaterThanOrEqual(1);
    const warehouseReport = await request(app.getHttpServer()).get(url("/reports/warehouse")).set("Cookie", manager.cookie);
    expect(warehouseReport.status).toBe(200);
    expect(warehouseReport.body.counts.completedEvents).toBeGreaterThanOrEqual(1);
  });

  it("TC-P9-04 exports only authorized scoped rows with CSV escaping and no mutable payloads", async () => {
    const denied = await request(app.getHttpServer()).get(url("/reports/export?report=requests")).set("Cookie", employee.cookie);
    expect(denied.status).toBe(403);
    const foreign = await request(app.getHttpServer()).get(url(`/reports/export?report=requests&branchId=${otherBranchId}`)).set("Cookie", manager.cookie);
    expect(foreign.status).toBe(403);
    const exported = await request(app.getHttpServer()).get(url("/reports/export?report=requests")).set("Cookie", manager.cookie);
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.text.startsWith("\uFEFF")).toBe(true);
    expect(exported.text).toContain("'=P9Creator-");
    expect(exported.text).not.toContain('"=P9Creator-');
    expect(exported.text).not.toContain(otherBranchId);
  });

  it("TC-P9-05 records representative dashboard and request-report timings on TiDB", async () => {
    for (let index = 0; index < 12; index += 1) {
      const submittedAt = new Date(Date.now() - (index + 1) * 60_000);
      const reportRequest = await prisma.requestRecord.create({
        data: {
          requestNumber: `P9-PERF-${suffix}-${index}`,
          branchId,
          createdByUserId: employee.userId,
          status: index % 3 === 0 ? RequestStatus.completed : RequestStatus.pending_approval,
          submittedAt,
          approvedAt: index % 3 === 0 ? new Date(submittedAt.getTime() + 60_000) : null,
          warehouseAvailableAt: index % 3 === 0 ? new Date(submittedAt.getTime() + 120_000) : null,
        },
      });
      requestIds.push(reportRequest.id);
      await prisma.requestItem.create({
        data: {
          requestId: reportRequest.id,
          branchItemIdSnapshot: branchItemId,
          itemIdSnapshot: (await prisma.branchItem.findUniqueOrThrow({ where: { id: branchItemId } })).itemId,
          itemUnitIdSnapshot: unitId,
          branchItemSupplierIdSnapshot: (await prisma.branchItemSupplier.findFirstOrThrow({ where: { branchItemId, supplierId } })).id,
          supplierIdSnapshot: supplierId,
          supplierCodeSnapshot: `P9-SUP-${suffix}`,
          supplierNameSnapshot: "Snapshot Supplier",
          requestedQuantity: "3",
          conversionFactorSnapshot: "2",
          baseQuantitySnapshot: "6",
        },
      });
      await prisma.requestStatusHistory.create({ data: { requestId: reportRequest.id, actorType: "user", actorUserId: employee.userId, fromStatus: RequestStatus.draft, toStatus: RequestStatus.pending_approval, occurredAt: submittedAt } });
      if (index % 3 === 0) {
        await prisma.requestStatusHistory.create({ data: { requestId: reportRequest.id, actorType: "user", actorUserId: manager.userId, fromStatus: RequestStatus.pending_approval, toStatus: RequestStatus.approved, occurredAt: new Date(submittedAt.getTime() + 60_000) } });
        await prisma.requestStatusHistory.create({ data: { requestId: reportRequest.id, actorType: "user", actorUserId: manager.userId, fromStatus: RequestStatus.approved, toStatus: RequestStatus.sent_to_warehouse, occurredAt: new Date(submittedAt.getTime() + 120_000) } });
        await prisma.requestStatusHistory.create({ data: { requestId: reportRequest.id, actorType: "user", actorUserId: warehouse.userId, fromStatus: RequestStatus.sent_to_warehouse, toStatus: RequestStatus.completed, occurredAt: new Date(submittedAt.getTime() + 180_000) } });
      }
    }
    const dashboardStartedAt = Date.now();
    const dashboard = await request(app.getHttpServer()).get(url("/reports/dashboard")).set("Cookie", manager.cookie);
    const dashboardMs = Date.now() - dashboardStartedAt;
    const requestsStartedAt = Date.now();
    const detailed = await request(app.getHttpServer()).get(url("/reports/requests?page=1&pageSize=50&sort=submittedAt&direction=desc")).set("Cookie", manager.cookie);
    const requestsMs = Date.now() - requestsStartedAt;
    expect(dashboard.status).toBe(200);
    expect(detailed.status).toBe(200);
    expect(dashboardMs).toBeLessThan(60_000);
    expect(requestsMs).toBeLessThan(60_000);
    console.info("phase9-performance", JSON.stringify({ fixtureRequests: 12, dashboardMs, requestsMs, environment: "TiDB test fixture; observation only, not a production SLA" }));
  });

  it("TC-P9C1-01 attributes a resubmitted approval duration only to the manager who approved it", async () => {
    const before = await request(app.getHttpServer()).get(url("/reports/approvals")).set("Cookie", admin.cookie);
    expect(before.status).toBe(200);
    const pending = await submit(employee, branchId, branchItemId);
    const returned = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/return`)).set(headers(returningManager)).send({ expectedRowVersion: pending.rowVersion, reason: "مراجعة مدير A" });
    expect(returned.status).toBe(201);
    const employeeView = await request(app.getHttpServer()).get(url(`/requisitions/${pending.id}`)).set("Cookie", employee.cookie);
    expect(employeeView.status).toBe(200);
    const changed = await request(app.getHttpServer()).patch(url(`/requisitions/${pending.id}/items/${employeeView.body.items[0].id}`)).set(headers(employee)).send({ branchItemId, itemUnitId: unitId, requestedQuantity: "4", expectedRowVersion: employeeView.body.rowVersion });
    expect(changed.status).toBe(200);
    const resubmitted = await request(app.getHttpServer()).post(url(`/requisitions/${pending.id}/resubmit`)).set(headers(employee)).send({ expectedRowVersion: changed.body.rowVersion });
    expect(resubmitted.status).toBe(201);
    const approved = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/approve`)).set(headers(approvingManager)).send({ expectedRowVersion: resubmitted.body.rowVersion });
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe(RequestStatus.sent_to_warehouse);
    const report = await request(app.getHttpServer()).get(url("/reports/approvals")).set("Cookie", admin.cookie);
    expect(report.status).toBe(200);
    const returnedRow = report.body.byManager.find((row: { actor: { id: string } }) => row.actor.id === returningManager.userId);
    const approvedRow = report.body.byManager.find((row: { actor: { id: string } }) => row.actor.id === approvingManager.userId);
    expect(returnedRow).toMatchObject({ approved: 0, returned: 1, rejected: 0, averageApprovalCycleMinutes: null });
    expect(approvedRow).toMatchObject({ approved: 1, returned: 0, rejected: 0 });
    expect(typeof approvedRow.averageApprovalCycleMinutes).toBe("number");
    expect(report.body.decisionCounts.approved).toBe(before.body.decisionCounts.approved + 1);
    expect(report.body.decisionCounts.returned).toBe(before.body.decisionCounts.returned + 1);
    expect(report.body.decisionCounts.total).toBe(before.body.decisionCounts.total + 2);
    const beforeBranch = before.body.byBranch.find((row: { branch: { id: string } }) => row.branch.id === branchId) ?? { approved: 0, returned: 0, rejected: 0 };
    const afterBranch = report.body.byBranch.find((row: { branch: { id: string } }) => row.branch.id === branchId);
    expect(afterBranch).toMatchObject({ approved: beforeBranch.approved + 1, returned: beforeBranch.returned + 1, rejected: beforeBranch.rejected });
    const exported = await request(app.getHttpServer()).get(url("/reports/export?report=approvals")).set("Cookie", admin.cookie);
    expect(exported.status).toBe(200);
    expect(exported.text).toContain(returningManagerUsername);
    expect(exported.text).toContain(approvingManagerUsername);
    expect(exported.text).toContain(`"${returningManagerUsername}","0","1","0","N/A"`);
  });

  it("TC-P9C1-02 keeps a rejecting-only manager approval duration null", async () => {
    const pending = await submit(employee, branchId, branchItemId);
    const rejected = await request(app.getHttpServer()).post(url(`/manager/requests/${pending.id}/reject`)).set(headers(rejectingManager)).send({ expectedRowVersion: pending.rowVersion, reason: "قرار رفض نهائي" });
    expect(rejected.status).toBe(201);
    expect(rejected.body.status).toBe(RequestStatus.rejected);
    expect((await request(app.getHttpServer()).post(url(`/requisitions/${pending.id}/resubmit`)).set(headers(employee)).send({ expectedRowVersion: rejected.body.rowVersion })).status).toBe(400);
    const report = await request(app.getHttpServer()).get(url("/reports/approvals")).set("Cookie", admin.cookie);
    expect(report.status).toBe(200);
    const rejectedRow = report.body.byManager.find((row: { actor: { id: string } }) => row.actor.id === rejectingManager.userId);
    expect(rejectedRow).toMatchObject({ approved: 0, returned: 0, rejected: 1, averageApprovalCycleMinutes: null });
    const exported = await request(app.getHttpServer()).get(url("/reports/export?report=approvals")).set("Cookie", admin.cookie);
    expect(exported.status).toBe(200);
    expect(exported.text).toContain(`"${rejectingManagerUsername}","0","0","1","N/A"`);
  });
});
