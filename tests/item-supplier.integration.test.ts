import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ItemSetupService } from "../apps/api/src/item-setup.service.js";
import { ItemSupplierService } from "../apps/api/src/item-supplier.service.js";
import { RequestLinePreparationService } from "../apps/api/src/request-line-preparation.service.js";
import { RequestSubmissionService } from "../apps/api/src/request-submission.service.js";
import { secureMysqlUrl } from "../apps/api/src/config.js";

const prisma = new PrismaClient({
  datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL!) } },
});
const setup = new ItemSetupService(prisma as never, {} as never);
const suppliers = new ItemSupplierService(prisma as never);
const lines = new RequestLinePreparationService(prisma as never, suppliers);
const submissions = new RequestSubmissionService(prisma as never, lines);
const suffix = randomUUID().slice(0, 8);
let actorId: string,
  itemId: string,
  itemUnitId: string,
  categoryId: string,
  unitId: string,
  supplierId: string,
  otherSupplierId: string;
const branchIds: string[] = [];
const requestIds: string[] = [];

beforeAll(async () => {
  actorId = (
    await prisma.user.create({
      data: { username: `setup-${suffix}`, passwordHash: "test-only" },
    })
  ).id;
  categoryId = (
    await prisma.category.create({
      data: { code: `SETUP-${suffix}`, nameAr: "مواد غذائية" },
    })
  ).id;
  unitId = (
    await prisma.unit.create({
      data: { code: `SETUP-${suffix}`, nameAr: "كيلوغرام" },
    })
  ).id;
  supplierId = (
    await prisma.supplier.create({
      data: { supplierCode: `SETUP-A-${suffix}`, supplierName: "المورد الأول" },
    })
  ).id;
  otherSupplierId = (
    await prisma.supplier.create({
      data: {
        supplierCode: `SETUP-B-${suffix}`,
        supplierName: "المورد الثاني",
      },
    })
  ).id;
  for (const code of ["A", "B"])
    branchIds.push(
      (
        await prisma.branch.create({
          data: {
            code: `SETUP-${code}-${suffix}`,
            nameAr: "مطعم",
            nameEn: "Restaurant",
          },
        })
      ).id
    );
});
afterAll(async () => {
  await prisma.notification.deleteMany({ where: { recipientUserId: actorId } });
  await prisma.requestStatusHistory.deleteMany({
    where: { requestId: { in: requestIds } },
  });
  await prisma.requestItem.deleteMany({
    where: { requestId: { in: requestIds } },
  });
  await prisma.requestRecord.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: actorId } });
  if (itemId) {
    await prisma.branchItem.deleteMany({ where: { itemId } });
    await prisma.itemUnit.deleteMany({ where: { itemId } });
    await prisma.item.delete({ where: { id: itemId } });
  }
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.category.delete({ where: { id: categoryId } });
  await prisma.unit.delete({ where: { id: unitId } });
  await prisma.supplier.deleteMany({
    where: { id: { in: [supplierId, otherSupplierId] } },
  });
  await prisma.user.delete({ where: { id: actorId } });
  await prisma.$disconnect();
});

describe("Unified item supplier and restaurant assignment", () => {
  it("stores multilingual item details and its base unit in one save before any restaurant assignment", async () => {
    const saved = await setup.saveItem(actorId, {
      sku: `SETUP-${suffix}`,
      categoryId,
      nameAr: "أرز",
      nameEn: "Rice",
      nameUr: "چاول",
      baseUnitId: unitId,
      status: "active",
    });
    itemId = saved.id;
    itemUnitId = saved.itemUnits[0].id;
    expect(saved.itemUnits[0].conversionFactorToBase.toString()).toBe("1");
    expect(await prisma.branchItem.count({ where: { itemId } })).toBe(0);
    await setup.setSupplier(actorId, itemId, supplierId);
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: itemId } }))
        .defaultSupplierId
    ).toBe(supplierId);
  });
  it("shares one supplier across the restaurants assigned the same item without legacy supplier links", async () => {
    for (const branchId of branchIds)
      await setup.assignRestaurantItems(actorId, branchId, [itemId], []);
    const links = await prisma.branchItem.findMany({ where: { itemId } });
    expect(links).toHaveLength(2);
    for (const link of links)
      expect(
        (await suppliers.resolveForBranchItem(prisma as never, link.id))
          ?.supplierId
      ).toBe(supplierId);
    const tables = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branch_item_suppliers'`;
    expect(Number(tables[0].count)).toBe(0);
  });
  it("freezes the submitted supplier while later requests use the new item supplier", async () => {
    const link = await prisma.branchItem.findFirstOrThrow({
      where: { itemId, branchId: branchIds[0] },
    });
    const request = await prisma.requestRecord.create({
      data: {
        requestNumber: `SETUP-${suffix}`,
        branchId: branchIds[0],
        createdByUserId: actorId,
      },
    });
    requestIds.push(request.id);
    const line = await lines.createDraftLine({
      requestId: request.id,
      branchItemId: link.id,
      itemUnitId,
      requestedQuantity: 3,
    });
    await submissions.submitFirstTime(request.id, actorId);
    await setup.setSupplier(actorId, itemId, otherSupplierId);
    expect(
      (await prisma.requestItem.findUniqueOrThrow({ where: { id: line.id } }))
        .supplierIdSnapshot
    ).toBe(supplierId);
    expect(
      (await suppliers.resolveForBranchItem(prisma as never, link.id))
        ?.supplierId
    ).toBe(otherSupplierId);
  });
  it("enforces supplier status and foreign keys and detects stale restaurant selections", async () => {
    const link = await prisma.branchItem.findFirstOrThrow({
      where: { itemId },
    });
    await prisma.supplier.update({
      where: { id: otherSupplierId },
      data: { status: "inactive" },
    });
    expect(
      await suppliers.resolveForBranchItem(prisma as never, link.id)
    ).toBeNull();
    await prisma.supplier.update({
      where: { id: otherSupplierId },
      data: { status: "active" },
    });
    await expect(
      setup.assignRestaurantItems(actorId, branchIds[0], [], [])
    ).rejects.toThrow(/changed/);
    await expect(
      prisma.item.update({
        where: { id: itemId },
        data: { defaultSupplierId: randomUUID() },
      })
    ).rejects.toThrow(/foreign key/i);
  });
});
