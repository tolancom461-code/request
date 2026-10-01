import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication } from "../apps/api/src/main.js";
import { secureMysqlUrl } from "../apps/api/src/config.js";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const password = "phase3-admin-password";
const suffix = randomUUID().slice(0, 8);
const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];
const createdBranchIds: string[] = [];
const createdSupplierIds: string[] = [];
const createdUnitIds: string[] = [];
const createdCategoryIds: string[] = [];
let app: NestFastifyApplication;
let adminCookie = "";
let adminCsrf = "";
let employeeCookie = "";
let baseBranchId = "";
let systemAdminRoleId = "";
let branchEmployeeRoleId = "";
let adminUserId = "";

type Login = { cookie: string; csrfToken: string };

async function createUser(roleCode: string, emailPrefix: string, status: "active" | "inactive" = "active") {
  const token = randomUUID().slice(0, 8);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const user = await prisma.user.create({ data: { username: `${emailPrefix}-${token}`, email: `${emailPrefix}-${suffix}-${token}@example.test`, passwordHash: await argon2.hash(password), status, roles: { create: { roleId: role.id } } } });
  createdUserIds.push(user.id);
  return user;
}

async function login(username: string): Promise<Login> {
  const response = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ username, password });
  expect(response.status).toBe(201);
  return { cookie: response.headers["set-cookie"]?.[0].split(";")[0] as string, csrfToken: response.body.csrfToken as string };
}

const adminGet = (path: string) => request(app.getHttpServer()).get(path).set("Cookie", adminCookie);
const employeeGet = (path: string) => request(app.getHttpServer()).get(path).set("Cookie", employeeCookie);
const adminMutate = (method: "post" | "patch", path: string) => request(app.getHttpServer())[method](path).set("Cookie", adminCookie).set("Origin", "http://localhost:5173").set("X-CSRF-Token", adminCsrf);

beforeAll(async () => {
  process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
  await prisma.$connect();
  const admin = await createUser("system_admin", "phase3-admin");
  adminUserId = admin.id;
  const employee = await createUser("branch_employee", "phase3-employee");
  const branch = await prisma.branch.create({ data: { code: `P3-BASE-${suffix}`, nameAr: "فرع المرحلة الثالثة", nameEn: "Phase Three Branch" } });
  createdBranchIds.push(branch.id);
  baseBranchId = branch.id;
  systemAdminRoleId = (await prisma.role.findUniqueOrThrow({ where: { code: "system_admin" } })).id;
  branchEmployeeRoleId = (await prisma.role.findUniqueOrThrow({ where: { code: "branch_employee" } })).id;
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  ({ cookie: adminCookie, csrfToken: adminCsrf } = await login(admin.username));
  ({ cookie: employeeCookie } = await login(employee.username));
});

afterAll(async () => {
  await app?.close();
  for (const userId of createdUserIds) {
    await prisma.serverSession.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
    await prisma.userBranchScope.deleteMany({ where: { userId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  for (const roleId of createdRoleIds) {
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.userRole.deleteMany({ where: { roleId } });
    await prisma.role.deleteMany({ where: { id: roleId } });
  }
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...createdBranchIds, ...createdSupplierIds, ...createdUnitIds, ...createdCategoryIds] } } });
  await prisma.supplier.deleteMany({ where: { id: { in: createdSupplierIds } } });
  await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  await prisma.unit.deleteMany({ where: { id: { in: createdUnitIds } } });
  await prisma.branch.deleteMany({ where: { id: { in: createdBranchIds } } });
  await prisma.$disconnect();
});

describe("Phase 3 master-data administration", () => {
  it("rejects unauthenticated reads, rejects non-admin users, and rejects missing CSRF mutations", async () => {
    expect((await request(app.getHttpServer()).get("/api/v1/admin/branches")).status).toBe(401);
    expect((await employeeGet("/api/v1/admin/branches")).status).toBe(403);
    expect((await request(app.getHttpServer()).post("/api/v1/admin/branches").set("Cookie", adminCookie).set("Origin", "http://localhost:5173").send({ code: `P3-NO-CSRF-${suffix}`, nameAr: "بدون", nameEn: "No CSRF" })).status).toBe(401);
  });

  it("creates, lists, searches, updates and deactivates branches with a controlled unique conflict", async () => {
    const code = `P3-BR-${suffix}`;
    const created = await adminMutate("post", "/api/v1/admin/branches").send({ code, nameAr: "فرع تجريبي", nameEn: "Test Branch" });
    expect(created.status).toBe(201);
    createdBranchIds.push(created.body.id);
    expect((await adminMutate("post", "/api/v1/admin/branches").send({ code, nameAr: "مكرر", nameEn: "Duplicate" })).status).toBe(409);
    const listed = await adminGet(`/api/v1/admin/branches?search=${encodeURIComponent(code)}&status=active&page=1&pageSize=10&sortBy=code&sortDir=asc`);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect((await adminMutate("patch", `/api/v1/admin/branches/${created.body.id}`).send({ nameEn: "Updated Branch" })).body.nameEn).toBe("Updated Branch");
    const deactivated = await adminMutate("post", `/api/v1/admin/branches/${created.body.id}/status`).send({ status: "inactive" });
    expect(deactivated.status).toBe(201);
    expect(deactivated.body.status).toBe("inactive");
  });

  it("operates suppliers, units and categories with safe status semantics and unique conflicts", async () => {
    const supplier = await adminMutate("post", "/api/v1/admin/suppliers").send({ supplierCode: `P3-SUP-${suffix}`, supplierName: "Phase Three Supplier", taxNumber: `TAX-${suffix}` });
    expect(supplier.status).toBe(201); createdSupplierIds.push(supplier.body.id);
    expect((await adminMutate("post", "/api/v1/admin/suppliers").send({ supplierCode: `P3-SUP-ALT-${suffix}`, supplierName: "Duplicate Tax", taxNumber: `TAX-${suffix}` })).status).toBe(409);
    expect((await adminMutate("post", `/api/v1/admin/suppliers/${supplier.body.id}/status`).send({ status: "inactive" })).body.deletedAt).toBeTruthy();
    expect((await adminMutate("post", `/api/v1/admin/suppliers/${supplier.body.id}/status`).send({ status: "active" })).body.deletedAt).toBeNull();
    const unit = await adminMutate("post", "/api/v1/admin/units").send({ code: `P3-UNIT-${suffix}`, nameAr: "وحدة اختبار", nameEn: "Test Unit" });
    expect(unit.status).toBe(201); createdUnitIds.push(unit.body.id);
    expect((await adminMutate("post", "/api/v1/admin/units").send({ code: `P3-UNIT-${suffix}`, nameAr: "وحدة مكررة" })).status).toBe(409);
    expect((await adminMutate("post", `/api/v1/admin/units/${unit.body.id}/status`).send({ status: "inactive" })).body.status).toBe("inactive");
    const category = await adminMutate("post", "/api/v1/admin/categories").send({ code: `P3-CAT-${suffix}`, nameAr: "فئة اختبار", nameEn: "Test Category" });
    expect(category.status).toBe(201); createdCategoryIds.push(category.body.id);
    expect((await adminMutate("post", `/api/v1/admin/categories/${category.body.id}/status`).send({ status: "inactive" })).body.deletedAt).toBeTruthy();
    expect((await adminMutate("post", `/api/v1/admin/categories/${category.body.id}/status`).send({ status: "active" })).body.deletedAt).toBeNull();
  });

  it("creates users with Argon2id without exposing passwordHash and applies role/scope changes atomically", async () => {
    const created = await adminMutate("post", "/api/v1/admin/users").send({ username: `phase3-target-${suffix}`, email: `phase3-target-${suffix}@example.test`, password: "phase3-target-password", roleIds: [branchEmployeeRoleId], branchIds: [baseBranchId] });
    expect(created.status).toBe(201);
    createdUserIds.push(created.body.id);
    expect(created.body.passwordHash).toBeUndefined();
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.passwordHash).toBeTruthy();
    expect(await argon2.verify(stored.passwordHash!, "phase3-target-password")).toBe(true);
    const detail = await adminGet(`/api/v1/admin/users/${created.body.id}`);
    expect(detail.body.passwordHash).toBeUndefined();
    const failedRoleReplace = await adminMutate("post", `/api/v1/admin/users/${created.body.id}/roles`).send({ ids: [randomUUID()] });
    expect(failedRoleReplace.status).toBe(400);
    expect(await prisma.userRole.count({ where: { userId: created.body.id } })).toBe(1);
    const failedScopeReplace = await adminMutate("post", `/api/v1/admin/users/${created.body.id}/branch-scopes`).send({ ids: [randomUUID()] });
    expect(failedScopeReplace.status).toBe(400);
    expect(await prisma.userBranchScope.count({ where: { userId: created.body.id } })).toBe(1);
    expect((await adminMutate("post", `/api/v1/admin/users/${created.body.id}/password`).send({ password: "phase3-reset-password" })).body.success).toBe(true);
    expect(await argon2.verify((await prisma.user.findUniqueOrThrow({ where: { id: created.body.id } })).passwordHash!, "phase3-reset-password")).toBe(true);
    const deactivated = await adminMutate("patch", `/api/v1/admin/users/${created.body.id}`).send({ status: "inactive" });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toMatchObject({ status: "inactive" });
    expect((await request(app.getHttpServer()).post("/api/v1/auth/login").send({ username: stored.username, password: "phase3-reset-password" })).status).toBe(401);
  });

  it("protects System Admin capability and supports safe custom role permission assignment", async () => {
    const permissions = await adminGet("/api/v1/admin/permissions");
    expect(permissions.status).toBe(200);
    const adminManageId = permissions.body.find((permission: { code: string }) => permission.code === "admin.manage")?.id as string;
    expect(adminManageId).toBeTruthy();
    expect((await adminMutate("post", `/api/v1/admin/roles/${systemAdminRoleId}/permissions`).send({ ids: [] })).status).toBe(409);
    const custom = await adminMutate("post", "/api/v1/admin/roles").send({ code: `phase3_role_${suffix}`, name: "Phase 3 Role", description: "Temporary integration role" });
    expect(custom.status).toBe(201); createdRoleIds.push(custom.body.id);
    const assigned = await adminMutate("post", `/api/v1/admin/roles/${custom.body.id}/permissions`).send({ ids: [adminManageId] });
    expect(assigned.status).toBe(201);
    expect(assigned.body.permissions.map((permission: { id: string }) => permission.id)).toContain(adminManageId);
    expect((await adminMutate("post", `/api/v1/admin/users/${adminUserId}/roles`).send({ ids: [branchEmployeeRoleId] })).status).toBe(403);
  });
});
