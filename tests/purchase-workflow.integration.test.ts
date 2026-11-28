import { randomUUID } from "node:crypto";
import { PrismaClient, type RequestStatus } from "@prisma/client";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { documentYear } from "../apps/api/src/document-numbering.service.js";
import { createApplication } from "../apps/api/src/main.js";
import { SessionService } from "../apps/api/src/session.service.js";

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const origin = "http://localhost:5173";
let app: NestFastifyApplication;
let branchId: string, itemId: string, branchItemId: string, boxId: string, pieceId: string;
let supplierA: string, supplierB: string, unlinkedSupplier: string, userId: string;
let warehouse: Record<string, string>, outsider: Record<string, string>, admin: Record<string, string>;

async function session(roleCode: string, scopedBranch?: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const user = await prisma.user.create({ data: {
    username: `purchase-${suffix}-${randomUUID().slice(0, 5)}`,
    roles: { create: { roleId: role.id } },
    ...(scopedBranch && { branchScopes: { create: { branchId: scopedBranch } } }),
  } });
  const session = await app.get(SessionService).create(user.id);
  const cookieName = (process.env.SESSION_COOKIE_NAME ?? "__Host-session").replace(/^__Host-/, "");
  return { userId: user.id, headers: { cookie: `${cookieName}=${session.id}`, "x-csrf-token": session.csrfToken, origin } };
}

beforeAll(async () => {
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  branchId = (await prisma.branch.create({ data: { code: `PU-${suffix}`, nameAr: "مطعم المشتريات", nameEn: "Purchase restaurant" } })).id;
  const main = await session("warehouse_manager", branchId);
  userId = main.userId;
  warehouse = main.headers;
  outsider = (await session("warehouse_manager")).headers;
  admin = (await session("system_admin")).headers;

  const category = await prisma.category.create({ data: { code: `PU-${suffix}`, nameAr: "مشروبات" } });
  const [a, b, c] = await Promise.all(["A", "B", "C"].map(code => prisma.supplier.create({ data: { supplierCode: `${code}-${suffix}`, supplierName: `Supplier ${code}` } })));
  supplierA = a.id;
  supplierB = b.id;
  unlinkedSupplier = c.id;
  const item = await prisma.item.create({ data: {
    sku: `MILK-${suffix}`, nameAr: "حليب", categoryId: category.id, defaultSupplierId: supplierA,
    supplierLinks: { create: [{ supplierId: supplierA }, { supplierId: supplierB }] },
  } });
  itemId = item.id;
  branchItemId = (await prisma.branchItem.create({ data: { branchId, itemId } })).id;
  const [piece, box] = await Promise.all(["PC", "BOX"].map(code => prisma.unit.create({ data: { code: `${code}-${suffix}`, nameAr: code } })));
  pieceId = (await prisma.itemUnit.create({ data: { itemId, unitId: piece.id, conversionFactorToBase: 1, isBaseUnit: true, activeBaseItemId: itemId } })).id;
  boxId = (await prisma.itemUnit.create({ data: { itemId, unitId: box.id, conversionFactorToBase: 6 } })).id;
});

afterAll(async () => {
  // The runner only allows a disposable verification database.
  await app?.close();
  await prisma.$disconnect();
});

async function order(quantity: number, size: "piece" | "box", status: RequestStatus = "sent_to_warehouse") {
  const record = await prisma.requestRecord.create({ data: {
    requestNumber: `PU-${randomUUID()}`, branchId, createdByUserId: userId, status, warehouseAvailableAt: new Date(),
    items: { create: {
      branchItemIdSnapshot: branchItemId, itemIdSnapshot: itemId, itemUnitIdSnapshot: size === "piece" ? pieceId : boxId,
      supplierIdSnapshot: supplierA, supplierCodeSnapshot: `A-${suffix}`, supplierNameSnapshot: "Supplier A", requestedQuantity: quantity,
      conversionFactorSnapshot: size === "piece" ? 1 : 6, baseQuantitySnapshot: quantity * (size === "piece" ? 1 : 6),
    } },
  }, include: { items: true } });
  return { url: `/api/v1/warehouse/requests/${record.id}/purchasing`, lineId: record.items[0].id };
}

const post = (url: string, payload: object, headers = warehouse) => app.inject({ method: "POST", url, headers, payload });

it("imports opening purchases atomically, with original units, dates and no purchase documents", async () => {
  const historyUrl = `/api/v1/admin/item-setup/items/${itemId}/purchase-history`;
  const openingUrl = `${historyUrl}/opening`;
  const row = { supplierId: supplierA, itemUnitId: pieceId, quantity: "2", unitCost: "6", purchasedOn: "2024-10-01", invoiceReference: "OPEN-01" };
  const purchases = [
    { ...row, operationId: randomUUID() },
    { ...row, operationId: randomUUID(), itemUnitId: boxId, quantity: "1", unitCost: "42", purchasedOn: "2024-10-02", invoiceReference: "OPEN-02" },
    { ...row, operationId: randomUUID(), supplierId: supplierB, unitCost: "11", invoiceReference: "" },
    { ...row, operationId: randomUUID(), supplierId: unlinkedSupplier, unitCost: "12" },
  ];
  expect((await post(openingUrl, { purchases })).statusCode).toBe(403);
  expect((await post(openingUrl, { purchases: [purchases[0], { ...purchases[1], itemUnitId: randomUUID() }] }, admin)).statusCode).toBe(400);
  expect(await prisma.openingPurchase.count({ where: { itemId } })).toBe(0);
  const concurrent = await Promise.all([1, 2].map(() => post(openingUrl, { purchases }, admin)));
  expect(concurrent.map(result => result.statusCode)).toEqual([201, 201]);
  expect(concurrent.map(result => result.json().saved).sort()).toEqual([0, 4]);
  expect((await post(openingUrl, { purchases: [{ ...purchases[0], unitCost: "8" }] }, admin)).statusCode).toBe(409);
  expect(await prisma.purchaseSheet.count()).toBe(0);
  expect(await prisma.requestItem.count({ where: { itemIdSnapshot: itemId } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { entityId: itemId, action: "purchase.opening_recorded" } })).toBe(1);
  const history = await app.inject({ url: `${historyUrl}?supplierId=${supplierA}`, headers: admin });
  expect(history.statusCode).toBe(200);
  expect(history.json()).toMatchObject({
    total: 2, unitCode: `PC-${suffix}`,
    units: expect.arrayContaining([expect.objectContaining({ id: boxId, conversionFactor: "6" })]),
    suppliers: expect.arrayContaining([
      expect.objectContaining({ id: supplierA, lastCost: "7", averageCost: "6.75" }),
      expect.objectContaining({ id: unlinkedSupplier, lastCost: "12" }),
    ]),
    purchases: [
      expect.objectContaining({ source: "opening", unitCode: `BOX-${suffix}`, quantity: "1", unitCost: "42", purchasedOn: "2024-10-02", invoiceReference: "OPEN-02" }),
      expect.objectContaining({ source: "opening", quantity: "2", unitCost: "6", purchasedOn: "2024-10-01" }),
    ],
  });
  const replaceBase = await app.inject({
    method: "PATCH", url: `/api/v1/admin/items/${itemId}/units/${boxId}`, headers: admin,
    payload: { isBaseUnit: true, conversionFactorToBase: "1" },
  });
  expect(replaceBase.statusCode).toBe(400);
});

it("protects purchases by status, permission, and branch scope", async () => {
  const approved = await order(1, "piece");
  const pending = await order(1, "piece", "pending_approval");
  expect((await app.inject({ url: approved.url })).statusCode).toBe(401);
  expect((await app.inject({ url: approved.url, headers: outsider })).statusCode).toBe(403);
  expect((await app.inject({ url: pending.url, headers: warehouse })).statusCode).toBe(404);
  const role = await prisma.role.create({ data: { code: `purchase-view-${suffix}`, name: "View warehouse", permissions: { create: {
    permissionId: (await prisma.permission.findUniqueOrThrow({ where: { code: "warehouse.process" } })).id,
  } } } });
  const readOnly = await session(role.code, branchId);
  expect((await app.inject({ url: approved.url, headers: readOnly.headers })).statusCode).toBe(200);
  expect((await post(`${approved.url}/plan`, { expectedRevision: 0, basis: "last", allocations: [] }, readOnly.headers)).statusCode).toBe(403);
  expect((await post(`${approved.url}/issue`, { expectedRevision: 0 }, readOnly.headers)).statusCode).toBe(403);
  expect((await post(`${approved.url}/receipts`, {}, readOnly.headers)).statusCode).toBe(403);
});

it("splits the approved quantity, issues one document per supplier, and uses actual purchases for future comparisons", async () => {
  const first = await order(4, "box");
  const get = () => app.inject({ url: first.url, headers: warehouse });
  const detail = await get();
  expect(detail.statusCode).toBe(200);
  expect(detail.json().lines[0]).toMatchObject({ quantity: "4", defaultSupplierId: supplierA, suppliers: expect.arrayContaining([
    expect.objectContaining({ id: supplierA, lastCost: "42", averageCost: "40.5" }),
    expect.objectContaining({ id: supplierB, lastCost: "66", averageCost: "66" }),
  ]) });
  const allocation = (supplierId: string, quantity: string) => ({ requestItemId: first.lineId, supplierId, quantity });
  const save = (expectedRevision: number, allocations: object[]) => post(`${first.url}/plan`, { expectedRevision, allocations, basis: "last" });
  expect((await save(0, [allocation(unlinkedSupplier, "4")])).statusCode).toBe(400);
  expect((await save(0, [allocation(supplierA, "5")])).statusCode).toBe(400);
  expect((await save(0, [allocation(supplierA, "2")])).statusCode).toBe(201);
  expect((await post(`${first.url}/issue`, { expectedRevision: 1 })).statusCode).toBe(400);
  expect((await save(0, [allocation(supplierA, "4")])).statusCode).toBe(409);
  expect((await save(1, [allocation(supplierA, "3"), allocation(supplierB, "1")])).statusCode).toBe(201);
  const issued = await post(`${first.url}/issue`, { expectedRevision: 2 });
  expect(issued.statusCode).toBe(201);
  expect(issued.json().plan).toMatchObject({ status: "issued", revision: 3 });
  expect(issued.json().sheets.map((sheet: { number: string }) => sheet.number).sort()).toEqual([`Pur-${documentYear(new Date())}-0001`, `Pur-${documentYear(new Date())}-0002`]);
  expect((await post(`${first.url}/issue`, { expectedRevision: 2 })).json().sheets).toEqual(issued.json().sheets);
  const issuedA = issued.json().allocations.find((row: { supplierId: string }) => row.supplierId === supplierA);
  const receipt = { allocationId: issuedA.id, operationId: randomUUID(), quantity: "1", unitCost: "48", purchasedOn: "2026-11-23", invoiceReference: "INV-01" };
  const actual = await post(`${first.url}/receipts`, receipt);
  expect(actual.statusCode).toBe(201);
  expect(actual.json().purchases).toHaveLength(1);
  expect((await post(`${first.url}/receipts`, receipt)).json().purchases).toHaveLength(1);
  expect((await post(`${first.url}/receipts`, { ...receipt, unitCost: "50" })).statusCode).toBe(409);
  const concurrent = await Promise.all([1, 2].map(() => post(`${first.url}/receipts`, {
    ...receipt, operationId: randomUUID(), quantity: "2", unitCost: "60", purchasedOn: "2026-11-24", invoiceReference: "INV-02",
  })));
  expect(concurrent.map(response => response.statusCode).sort()).toEqual([201, 409]);
  expect((await get()).json().allocations).toContainEqual(expect.objectContaining({ id: issuedA.id, purchasedQuantity: "3", actualCost: "168", estimatedUnitCost: "42" }));

  const next = await order(2, "piece");
  const comparison = await app.inject({ url: next.url, headers: warehouse });
  expect(comparison.json().lines[0].suppliers).toContainEqual(expect.objectContaining({ id: supplierA, lastCost: "10", averageCost: "8.538462", lastPurchasedAt: "2026-11-24" }));
  expect((await post(`${next.url}/plan`, { expectedRevision: 0, basis: "average", allocations: [{ requestItemId: next.lineId, supplierId: supplierA, quantity: "2" }] })).statusCode).toBe(201);
  const nextIssue = await post(`${next.url}/issue`, { expectedRevision: 1 });
  expect(nextIssue.statusCode).toBe(201);
  expect(nextIssue.json().allocations[0]).toMatchObject({ estimatedUnitCost: "8.538462", actualCost: "0" });
  const history = await app.inject({ url: `/api/v1/admin/item-setup/items/${itemId}/purchase-history?supplierId=${supplierA}`, headers: admin });
  expect(history.statusCode).toBe(200);
  expect(history.json()).toMatchObject({
    unitCode: `PC-${suffix}`, total: 4,
    suppliers: expect.arrayContaining([expect.objectContaining({ id: supplierA, lastCost: "10", averageCost: "8.538462" })]),
    purchases: [
      expect.objectContaining({ source: "warehouse", unitCode: `BOX-${suffix}`, quantity: "2", unitCost: "60", invoiceReference: "INV-02" }),
      expect.objectContaining({ source: "warehouse", quantity: "1", unitCost: "48" }),
      expect.objectContaining({ source: "opening", quantity: "1", unitCost: "42" }),
      expect.objectContaining({ source: "opening", quantity: "2", unitCost: "6" }),
    ],
  });
});
