import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication } from "../apps/api/src/main.js";
import { DocumentNumberingService, documentYear } from "../apps/api/src/document-numbering.service.js";
import { RequisitionService } from "../apps/api/src/requisition.service.js";
import { SessionService } from "../apps/api/src/session.service.js";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

const prisma = new PrismaClient();
const other = new PrismaClient();
const numbering = new DocumentNumberingService(prisma as never);
const otherNumbering = new DocumentNumberingService(other as never);
let app: NestFastifyApplication;
let userId: string, employeeId: string, branchId: string, draftBranchId: string;
let adminCookie: string, employeeCookie: string;
beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  userId = (await prisma.user.create({ data: { username: `number-admin-${suffix}` } })).id;
  employeeId = (await prisma.user.create({ data: { username: `number-employee-${suffix}` } })).id;
  for (const [id, code] of [[userId, "system_admin"], [employeeId, "branch_employee"]]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    await prisma.userRole.create({ data: { userId: id, roleId: role.id } });
  }
  branchId = (await prisma.branch.create({ data: { code: `NUM-${suffix}`, nameAr: "اختبار الترقيم", nameEn: "Numbering" } })).id;
  draftBranchId = (await prisma.branch.create({ data: { code: `DRAFT-${suffix}`, nameAr: "اختبار السلة", nameEn: "Draft" } })).id;
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const sessions = app.get(SessionService);
  const cookieName = (process.env.SESSION_COOKIE_NAME ?? "__Host-session").replace(/^__Host-/, "");
  adminCookie = `${cookieName}=${(await sessions.create(userId)).id}`;
  employeeCookie = `${cookieName}=${(await sessions.create(employeeId)).id}`;
});
afterAll(async () => {
  await app?.close();
  // This suite only runs against the runner's isolated REQUEST_verify_* database.
  await other.$disconnect();
  await prisma.$disconnect();
});

describe("Central numbering on TiDB", () => {
  it("starts a new annual sequence at 0001", async () => {
    const at = new Date("2090-06-01T00:00:00Z");
    expect(await numbering.transaction(tx => numbering.next(tx, "requisition", at))).toBe("Req-2090-0001");
    expect(await numbering.transaction(tx => numbering.next(tx, "requisition", at))).toBe("Req-2090-0002");
  });
  it("issues distinct committed document numbers concurrently across service instances", async () => {
    const services = [numbering, otherNumbering];
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => {
      const service = services[i % 2];
      return service.transaction(async tx => {
        const number = await service.next(tx, "requisition", new Date("2091-06-01T00:00:00Z"));
        await tx.requestRecord.create({ data: { requestNumber: number, branchId, createdByUserId: userId } });
        return number;
      });
    }));
    expect(new Set(results).size).toBe(16);
    expect(results.sort()).toEqual(Array.from({ length: 16 }, (_, i) => `Req-2091-${String(i + 1).padStart(4, "0")}`));
  });
  it("rolls numbering back together with a document that fails to save", async () => {
    await expect(numbering.transaction(async tx => {
      const number = await numbering.next(tx, "requisition", new Date("2092-06-01T00:00:00Z"));
      await tx.requestRecord.create({ data: { requestNumber: number, branchId: randomUUID(), createdByUserId: userId } });
    })).rejects.toThrow();
    expect(await numbering.transaction(tx => numbering.next(tx, "requisition", new Date("2092-06-01T00:00:00Z")))).toBe("Req-2092-0001");
  });
  it("starts a fresh counter at the Riyadh year boundary and retains the previous year", async () => {
    expect(await numbering.transaction(tx => numbering.next(tx, "requisition", new Date("2093-12-31T20:59:59Z")))).toBe("Req-2093-0001");
    expect(await numbering.transaction(tx => numbering.next(tx, "requisition", new Date("2093-12-31T21:00:00Z")))).toBe("Req-2094-0001");
    expect(await numbering.transaction(tx => numbering.next(tx, "requisition", new Date("2093-12-31T20:59:59Z")))).toBe("Req-2093-0002");
  });
  it("continues past 9999", async () => {
    await prisma.documentNumberSequence.create({ data: { prefix: "Req", year: 2095, lastValue: 9999n } });
    expect(await numbering.transaction(tx => numbering.next(tx, "requisition", new Date("2095-06-01T00:00:00Z")))).toBe("Req-2095-10000");
  });
  it("initializes the migration counter from existing formatted references without changing them", async () => {
    const legacy = await prisma.requestRecord.create({ data: { requestNumber: "Req-2096-0042", branchId, createdByUserId: userId } });
    const sql = readFileSync("prisma/migrations/20261123160000_central_document_numbering/migration.sql", "utf8");
    await prisma.$executeRawUnsafe(sql.slice(sql.indexOf("INSERT INTO")));
    expect((await prisma.requestRecord.findUniqueOrThrow({ where: { id: legacy.id } })).requestNumber).toBe("Req-2096-0042");
    expect(await numbering.transaction(tx => numbering.next(tx, "requisition", new Date("2096-06-01T00:00:00Z")))).toBe("Req-2096-0043");
  });
  it("resumes one draft under concurrent creation and never reuses a rejected request number", async () => {
    const year = documentYear(new Date());
    const before = (await prisma.documentNumberSequence.findUnique({ where: { prefix_year: { prefix: "Req", year } } }))?.lastValue ?? 0n;
    const service = app.get(RequisitionService);
    const drafts = await Promise.all(Array.from({ length: 4 }, () => service.createDraft(userId, draftBranchId)));
    expect(new Set(drafts.map(draft => draft.id)).size).toBe(1);
    expect((await prisma.documentNumberSequence.findUniqueOrThrow({ where: { prefix_year: { prefix: "Req", year } } })).lastValue).toBe(before + 1n);
    await prisma.requestRecord.update({ where: { id: drafts[0].id }, data: { status: "rejected" } });
    const next = await service.createDraft(userId, draftBranchId);
    expect(next.requestNumber).not.toBe(drafts[0].requestNumber);
    expect((await prisma.documentNumberSequence.findUniqueOrThrow({ where: { prefix_year: { prefix: "Req", year } } })).lastValue).toBe(before + 2n);
  });
  it("protects the numbering center and does not allocate numbers when it is read", async () => {
    const url = "/api/v1/admin/document-numbering";
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { cookie: employeeCookie } })).statusCode).toBe(403);
    const before = await numbering.status();
    const response = await app.inject({ url, headers: { cookie: adminCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(before);
    expect(await numbering.status()).toEqual(before);
  });
});
