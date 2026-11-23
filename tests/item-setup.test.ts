import { describe, expect, it, vi } from "vitest";
import { ItemSetupService } from "../apps/api/src/item-setup.service.js";

const input = {
  sku: "RICE",
  categoryId: "category",
  nameAr: "أرز",
  nameEn: "Rice",
  nameUr: "چاول",
  baseUnitId: "kg",
  status: "active" as const,
};
function fixture() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "locked" }]),
    category: { findFirst: vi.fn().mockResolvedValue({ id: "category" }) },
    unit: { findFirst: vi.fn().mockResolvedValue({ id: "kg" }) },
    item: {
      findUnique: vi.fn().mockResolvedValue({
        id: "rice",
        defaultSupplierId: null,
        imageObjectKey: null,
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "rice" }),
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn().mockImplementation(async ({ where }) => ({
        id: where.id,
        defaultSupplierId: "supplier",
        defaultSupplier: { id: "supplier", status: "active", deletedAt: null },
      })),
    },
    itemUnit: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
    },
    supplier: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: "supplier", status: "active" }),
    },
    branch: { findFirst: vi.fn().mockResolvedValue({ id: "restaurant" }) },
    branchItem: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockImplementation(async ({ create }) => ({
        id: `${create.branchId}-${create.itemId}`,
        ...create,
      })),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const prisma = { $transaction: vi.fn(async run => run(tx)) };
  const storage = {
    putItemImage: vi.fn().mockResolvedValue("items/rice/new.png"),
    removeItemImage: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ItemSetupService(prisma as never, storage as never);
  return { tx, prisma, storage, service };
}

describe("Item-first setup business operations", () => {
  it("saves multilingual details, image and an active base unit together before assigning any restaurant", async () => {
    const { service, tx, storage, prisma } = fixture();
    await service.saveItem("admin", input, {
      bytes: new Uint8Array([1, 2]),
      contentType: "image/png",
    });
    expect(storage.putItemImage).toHaveBeenCalledOnce();
    expect(tx.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nameAr: "أرز",
        nameEn: "Rice",
        nameUr: "چاول",
        imageObjectKey: "items/rice/new.png",
        status: "active",
      }),
    });
    expect(tx.itemUnit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          unitId: "kg",
          conversionFactorToBase: 1,
          isBaseUnit: true,
          status: "active",
        }),
      })
    );
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.branchItem.upsert).not.toHaveBeenCalled();
  });

  it("cleans up the new uploaded object when item validation fails without committing an item", async () => {
    const { service, tx, storage } = fixture();
    tx.unit.findFirst.mockResolvedValue(null);
    await expect(
      service.saveItem("admin", input, {
        bytes: new Uint8Array([1]),
        contentType: "image/png",
      })
    ).rejects.toThrow("active category and unit");
    expect(tx.item.create).not.toHaveBeenCalled();
    expect(storage.removeItemImage).toHaveBeenCalledWith("items/rice/new.png");
  });

  it("can choose the item supplier while no restaurants are linked", async () => {
    const { service, tx } = fixture();
    await expect(
      service.setSupplier("admin", "rice", "supplier")
    ).resolves.toMatchObject({ itemId: "rice", supplierId: "supplier" });
    expect(tx.item.update).toHaveBeenCalledWith({
      where: { id: "rice" },
      data: { defaultSupplierId: "supplier" },
    });
  });

  it("removes an image only after the item transaction succeeds", async () => {
    const { service, tx, storage } = fixture();
    tx.item.findUnique.mockResolvedValue({
      id: "rice",
      defaultSupplierId: null,
      imageObjectKey: "items/rice/old.png",
      status: "active",
    } as never);
    await service.saveItem(
      "admin",
      { ...input, removeImage: true },
      undefined,
      "rice"
    );
    expect(tx.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ imageObjectKey: null }),
      })
    );
    expect(storage.removeItemImage).toHaveBeenCalledWith("items/rice/old.png");
    expect(storage.putItemImage).not.toHaveBeenCalled();
  });

  it("keeps the previous image when the database transaction fails", async () => {
    const { service, tx, storage } = fixture();
    tx.item.findUnique.mockResolvedValue({
      id: "rice",
      defaultSupplierId: null,
      imageObjectKey: "items/rice/old.png",
    });
    tx.item.update.mockRejectedValue(new Error("write failed"));
    await expect(
      service.saveItem(
        "admin",
        input,
        { bytes: new Uint8Array([1]), contentType: "image/png" },
        "rice"
      )
    ).rejects.toThrow("write failed");
    expect(storage.removeItemImage).toHaveBeenCalledWith("items/rice/new.png");
    expect(storage.removeItemImage).not.toHaveBeenCalledWith(
      "items/rice/old.png"
    );
  });

  it("assigns the same item to two restaurants using its previously selected supplier", async () => {
    const { service, tx } = fixture();
    await service.assignRestaurantItems("admin", "foodzo", ["rice"], []);
    await service.assignRestaurantItems("admin", "other", ["rice"], []);
    expect(tx.branchItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { branchId: "foodzo", itemId: "rice" },
      })
    );
    expect(tx.branchItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { branchId: "other", itemId: "rice" } })
    );
    expect(tx.item.update).not.toHaveBeenCalled();
  });

  it("rejects a stale restaurant selection before altering any links", async () => {
    const { service, tx } = fixture();
    tx.branchItem.findMany.mockResolvedValue([
      { itemId: "rice", status: "active" },
    ] as never);
    await expect(
      service.assignRestaurantItems("admin", "foodzo", [], [])
    ).rejects.toThrow("changed");
    expect(tx.branchItem.update).not.toHaveBeenCalled();
    expect(tx.branchItem.upsert).not.toHaveBeenCalled();
  });

  it("rejects new assignments without a supplier or base unit", async () => {
    const { service, tx } = fixture();
    tx.item.findFirst.mockResolvedValueOnce({
      id: "rice",
      defaultSupplierId: null,
    } as never);
    await expect(
      service.assignRestaurantItems("admin", "foodzo", ["rice"], [])
    ).rejects.toThrow("active supplier");
    tx.itemUnit.count.mockResolvedValueOnce(0);
    await expect(
      service.assignRestaurantItems("admin", "foodzo", ["rice"], [])
    ).rejects.toThrow("base unit");
    expect(tx.branchItem.upsert).not.toHaveBeenCalled();
  });

  it("removes an unchecked restaurant link logically and retains the item", async () => {
    const { service, tx } = fixture();
    tx.branchItem.findMany.mockResolvedValue([
      { id: "link", itemId: "rice", status: "active" },
    ] as never);
    await service.assignRestaurantItems("admin", "foodzo", [], ["rice"]);
    expect(tx.branchItem.update).toHaveBeenCalledWith({
      where: { id: "link" },
      data: { status: "inactive", deletedAt: expect.any(Date) },
    });
    expect(tx.item.update).not.toHaveBeenCalled();
  });
});
