import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApplication } from "../apps/api/src/main.js";
import { secureMysqlUrl } from "../apps/api/src/config.js";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const suffix = randomUUID().slice(0, 8);
const password = "phase4-items-password";
let app: NestFastifyApplication;
let adminCookie = "";
let adminCsrf = "";
let employeeCookie = "";
let userIds: string[] = [];
let itemIds: string[] = [];
let categoryId = "";
let unitBaseId = "";
let unitAltId = "";
let branchId = "";
let supplierOneId = "";
let supplierTwoId = "";

const adminGet = (path: string) => request(app.getHttpServer()).get(path).set("Cookie", adminCookie);
const employeeGet = (path: string) => request(app.getHttpServer()).get(path).set("Cookie", employeeCookie);
const adminMutate = (method: "post" | "patch" | "delete", path: string) => request(app.getHttpServer())[method](path).set("Cookie", adminCookie).set("Origin", "http://localhost:5173").set("X-CSRF-Token", adminCsrf);

async function user(roleCode: string, prefix: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const entry = await prisma.user.create({ data: { username: `${prefix}-${suffix}`, email: `${prefix}-${suffix}@example.test`, passwordHash: await argon2.hash(password), roles: { create: { roleId: role.id } } } });
  userIds.push(entry.id);
  return entry;
}

beforeAll(async () => {
  process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
  await prisma.$connect();
  const admin = await user("system_admin", "phase4-admin");
  const employee = await user("branch_employee", "phase4-employee");
  const [category, baseUnit, altUnit, branch, supplierOne, supplierTwo] = await Promise.all([
    prisma.category.create({ data: { code: `P4-CAT-${suffix}`, nameAr: "فئة عناصر اختبار", nameEn: "Item Test Category" } }),
    prisma.unit.create({ data: { code: `P4-U1-${suffix}`, nameAr: "وحدة أساس", nameEn: "Base Unit" } }),
    prisma.unit.create({ data: { code: `P4-U2-${suffix}`, nameAr: "وحدة بديلة", nameEn: "Alternate Unit" } }),
    prisma.branch.create({ data: { code: `P4-BR-${suffix}`, nameAr: "فرع عناصر", nameEn: "Items Branch" } }),
    prisma.supplier.create({ data: { supplierCode: `P4-S1-${suffix}`, supplierName: "Supplier One" } }),
    prisma.supplier.create({ data: { supplierCode: `P4-S2-${suffix}`, supplierName: "Supplier Two" } }),
  ]);
  categoryId = category.id; unitBaseId = baseUnit.id; unitAltId = altUnit.id; branchId = branch.id; supplierOneId = supplierOne.id; supplierTwoId = supplierTwo.id;
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const login = async (username: string) => request(app.getHttpServer()).post("/api/v1/auth/login").send({ username, password });
  const adminLogin = await login(admin.username); adminCookie = adminLogin.headers["set-cookie"]?.[0].split(";")[0] as string; adminCsrf = adminLogin.body.csrfToken as string;
  const employeeLogin = await login(employee.username); employeeCookie = employeeLogin.headers["set-cookie"]?.[0].split(";")[0] as string;
}, 60_000);

afterAll(async () => {
  await app?.close();
  const branchItems = itemIds.length ? await prisma.branchItem.findMany({ where: { itemId: { in: itemIds } }, select: { id: true } }) : [];
  const branchItemIds = branchItems.map((entry) => entry.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: itemIds } }, { entityId: { in: branchItemIds } }] } });
  if (branchItemIds.length) await prisma.branchItemSupplier.deleteMany({ where: { branchItemId: { in: branchItemIds } } });
  if (branchItemIds.length) await prisma.branchItem.deleteMany({ where: { id: { in: branchItemIds } } });
  if (itemIds.length) await prisma.itemUnit.deleteMany({ where: { itemId: { in: itemIds } } });
  if (itemIds.length) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.unit.deleteMany({ where: { id: { in: [unitBaseId, unitAltId] } } });
  await prisma.branch.deleteMany({ where: { id: branchId } });
  await prisma.supplier.deleteMany({ where: { id: { in: [supplierOneId, supplierTwoId] } } });
  for (const id of userIds) { await prisma.serverSession.deleteMany({ where: { userId: id } }); await prisma.auditLog.deleteMany({ where: { actorUserId: id } }); await prisma.userRole.deleteMany({ where: { userId: id } }); await prisma.user.deleteMany({ where: { id } }); }
  await prisma.$disconnect();
}, 60_000);

describe("Phase 4 item configuration", () => {
  it("enforces authentication, admin.manage, and CSRF on item endpoints", async () => {
    expect((await request(app.getHttpServer()).get("/api/v1/admin/items")).status).toBe(401);
    expect((await employeeGet("/api/v1/admin/items")).status).toBe(403);
    expect((await request(app.getHttpServer()).post("/api/v1/admin/items").set("Cookie", adminCookie).set("Origin", "http://localhost:5173").send({ sku: `P4-NO-CSRF-${suffix}`, categoryId, nameAr: "بدون حماية", status: "inactive" })).status).toBe(401);
  }, 60_000);

  it("creates, validates, searches, and activates an item only after a valid active base unit exists", async () => {
    const sku = `P4-SKU-${suffix}`;
    const created = await adminMutate("post", "/api/v1/admin/items").send({ sku, barcode: `P4-BC-${suffix}`, categoryId, nameAr: "عنصر اختبار", nameEn: "Test Item", nameUr: "ٹیسٹ آئٹم", status: "inactive" });
    expect(created.status).toBe(201); itemIds.push(created.body.id);
    expect((await adminMutate("post", "/api/v1/admin/items").send({ sku, categoryId, nameAr: "مكرر", status: "inactive" })).status).toBe(409);
    expect((await adminMutate("post", `/api/v1/admin/items/${created.body.id}/status`).send({ status: "active" })).status).toBe(400);
    expect((await adminMutate("post", `/api/v1/admin/items/${created.body.id}/units`).send({ unitId: unitBaseId, conversionFactorToBase: "1", isBaseUnit: true, status: "active" })).status).toBe(201);
    expect((await adminMutate("post", `/api/v1/admin/items/${created.body.id}/units`).send({ unitId: unitAltId, conversionFactorToBase: "0.5", isBaseUnit: false, status: "active" })).status).toBe(201);
    expect((await adminMutate("post", `/api/v1/admin/items/${created.body.id}/units`).send({ unitId: unitAltId, conversionFactorToBase: "0.5" })).status).toBe(409);
    const configuredUnits = await adminGet(`/api/v1/admin/items/${created.body.id}/units`);
    const baseUnit = configuredUnits.body.find((unit: { isBaseUnit: boolean }) => unit.isBaseUnit) as { id: string };
    expect((await adminMutate("patch", `/api/v1/admin/items/${created.body.id}/units/${baseUnit.id}`).send({ conversionFactorToBase: "2" })).status).toBe(400);
    expect((await adminMutate("post", `/api/v1/admin/items/${created.body.id}/status`).send({ status: "active" })).body.status).toBe("active");
    const listed = await adminGet(`/api/v1/admin/items?search=${encodeURIComponent(sku)}&page=1&pageSize=10&sortBy=sku&sortDir=asc`);
    expect(listed.status).toBe(200); expect(listed.body.items[0]).toMatchObject({ sku, hasValidBaseUnit: true });
  }, 60_000);

  it("protects base-unit integrity and manages branch assignment and suppliers transactionally", async () => {
    const itemId = itemIds[0]!;
    const units = await adminGet(`/api/v1/admin/items/${itemId}/units`);
    const base = units.body.find((unit: { isBaseUnit: boolean }) => unit.isBaseUnit);
    expect((await adminMutate("patch", `/api/v1/admin/items/${itemId}/units/${base.id}`).send({ status: "inactive" })).status).toBe(400);
    const branchItem = await adminMutate("post", `/api/v1/admin/items/${itemId}/branches`).send({ branchId, status: "active" });
    expect(branchItem.status).toBe(201);
    expect((await adminMutate("post", `/api/v1/admin/items/${itemId}/branches`).send({ branchId, status: "active" })).status).toBe(201);
    const invalidDate = await adminMutate("post", `/api/v1/admin/branch-items/${branchItem.body.id}/suppliers`).send({ supplierId: supplierOneId, isPrimary: true, effectiveFrom: "2026-02-01", effectiveTo: "2026-01-31" });
    expect(invalidDate.status).toBe(400);
    const first = await adminMutate("post", `/api/v1/admin/branch-items/${branchItem.body.id}/suppliers`).send({ supplierId: supplierOneId, isPrimary: true, effectiveFrom: "2020-01-01" });
    expect(first.status).toBe(201); expect(first.body.activePrimaryBranchItemId).toBe(branchItem.body.id);
    const second = await adminMutate("post", `/api/v1/admin/branch-items/${branchItem.body.id}/suppliers`).send({ supplierId: supplierTwoId, isPrimary: true, effectiveFrom: "2020-01-01" });
    expect(second.status).toBe(409);
    const suppliers = await adminGet(`/api/v1/admin/branch-items/${branchItem.body.id}/suppliers`);
    expect(suppliers.body.filter((entry: { activePrimaryBranchItemId: string | null }) => entry.activePrimaryBranchItemId === branchItem.body.id)).toHaveLength(1);
  }, 60_000);

  it("rejects unsupported images and uploads/removes supported images using configured object storage", async () => {
    const itemId = itemIds[0]!;
    const unsupported = await adminMutate("post", `/api/v1/admin/items/${itemId}/image`).attach("file", Buffer.from("not-an-image"), { filename: "unsafe.txt", contentType: "text/plain" });
    expect(unsupported.status).toBe(400);

    const uploaded = await adminMutate("post", `/api/v1/admin/items/${itemId}/image`).attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: "image.png", contentType: "image/png" });
    expect(uploaded.status).toBe(201);

    const afterUpload = await adminGet(`/api/v1/admin/items/${itemId}`);
    expect(afterUpload.status).toBe(200);
    expect(afterUpload.body.imageObjectKey).toEqual(expect.any(String));
    expect(afterUpload.body.imageObjectKey.length).toBeGreaterThan(0);

    const removed = await adminMutate("delete", `/api/v1/admin/items/${itemId}/image`);
    expect(removed.status).toBe(200);
    expect((await adminGet(`/api/v1/admin/items/${itemId}`)).body.imageObjectKey).toBeNull();
  }, 60_000);
});
