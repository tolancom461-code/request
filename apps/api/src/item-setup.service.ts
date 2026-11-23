import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "./prisma.service.js";
import { StorageService } from "./storage.service.js";

type Tx = Prisma.TransactionClient;
export type SetupItemInput = {
  sku: string;
  barcode?: string | null;
  categoryId: string;
  nameAr: string;
  nameEn: string;
  nameUr: string;
  baseUnitId: string;
  status: "active" | "inactive";
  removeImage?: boolean;
};
export type SetupImage = { bytes: Uint8Array; contentType: string };
const txOptions = { maxWait: 10_000, timeout: 60_000 };
const sameIds = (a: string[], b: string[]) =>
  [...a].sort().join(",") === [...b].sort().join(",");

@Injectable()
export class ItemSetupService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService
  ) {}

  async options() {
    const [branches, suppliers, categories, units] = await Promise.all([
      this.prisma.branch.findMany({
        where: { status: "active" },
        orderBy: { code: "asc" },
      }),
      this.prisma.supplier.findMany({
        where: { status: "active", deletedAt: null },
        orderBy: { supplierCode: "asc" },
      }),
      this.prisma.category.findMany({
        where: { status: "active", deletedAt: null },
        orderBy: { code: "asc" },
      }),
      this.prisma.unit.findMany({
        where: { status: "active" },
        orderBy: { code: "asc" },
      }),
    ]);
    return { branches, suppliers, categories, units };
  }

  async items() {
    return this.prisma.item.findMany({
      orderBy: { sku: "asc" },
      include: {
        category: true,
        defaultSupplier: true,
        itemUnits: { include: { unit: true } },
        branchItems: { select: { branchId: true, status: true } },
      },
    });
  }

  private async audit(
    tx: Tx,
    actorUserId: string,
    entityType: string,
    entityId: string,
    action: string,
    afterData: Prisma.InputJsonValue
  ) {
    await tx.auditLog.create({
      data: {
        actorType: "user",
        actorUserId,
        entityType,
        entityId,
        action,
        afterData,
      },
    });
  }

  async saveItem(
    actorUserId: string,
    input: SetupItemInput,
    image?: SetupImage,
    itemId?: string
  ) {
    const id = itemId ?? randomUUID();
    if (image && input.removeImage)
      throw new BadRequestException(
        "Choose either image replacement or removal."
      );
    let nextImageKey: string | undefined;
    let previousImageKey: string | null = null;
    try {
      if (image)
        nextImageKey = await this.storage.putItemImage(
          id,
          image.bytes,
          image.contentType,
          image.bytes.byteLength
        );
      const result = await this.prisma.$transaction(async tx => {
        if (itemId)
          await tx.$queryRaw`SELECT id FROM items WHERE id = ${id} FOR UPDATE`;
        const before = itemId
          ? await tx.item.findUnique({ where: { id } })
          : null;
        if (itemId && !before)
          throw new NotFoundException("Item was not found.");
        previousImageKey = before?.imageObjectKey ?? null;
        const [category, unit] = await Promise.all([
          tx.category.findFirst({
            where: { id: input.categoryId, status: "active", deletedAt: null },
          }),
          tx.unit.findFirst({
            where: { id: input.baseUnitId, status: "active" },
          }),
        ]);
        if (!category || !unit)
          throw new BadRequestException("Choose an active category and unit.");
        const { baseUnitId, removeImage, ...fields } = input;
        const data = {
          ...fields,
          barcode: fields.barcode?.trim() || null,
          ...(fields.status === "active" ? { deletedAt: null } : {}),
          ...(nextImageKey ? { imageObjectKey: nextImageKey } : {}),
          ...(removeImage ? { imageObjectKey: null } : {}),
        };
        if (before) await tx.item.update({ where: { id }, data });
        else await tx.item.create({ data: { id, ...data } });
        const currentBase = await tx.itemUnit.findFirst({
          where: { itemId: id, isBaseUnit: true, status: "active" },
        });
        if (before && currentBase && currentBase.unitId !== baseUnitId) {
          const alternatives = await tx.itemUnit.count({
            where: { itemId: id, status: "active", isBaseUnit: false },
          });
          if (alternatives)
            throw new BadRequestException(
              "The base unit cannot be changed while alternate conversion units are active."
            );
        }
        await tx.itemUnit.updateMany({
          where: { itemId: id, isBaseUnit: true },
          data: { isBaseUnit: false, activeBaseItemId: null },
        });
        await tx.itemUnit.upsert({
          where: { itemId_unitId: { itemId: id, unitId: baseUnitId } },
          create: {
            itemId: id,
            unitId: baseUnitId,
            conversionFactorToBase: 1,
            isBaseUnit: true,
            status: "active",
            activeBaseItemId: id,
          },
          update: {
            conversionFactorToBase: 1,
            isBaseUnit: true,
            status: "active",
            activeBaseItemId: id,
          },
        });
        await this.audit(
          tx,
          actorUserId,
          "item",
          id,
          before ? "setup_item_updated" : "setup_item_created",
          {
            ...fields,
            baseUnitId,
            image: !removeImage && Boolean(nextImageKey ?? previousImageKey),
          }
        );
        return tx.item.findUniqueOrThrow({
          where: { id },
          include: {
            itemUnits: { include: { unit: true } },
            defaultSupplier: true,
          },
        });
      }, txOptions);
      if ((nextImageKey || input.removeImage) && previousImageKey)
        await this.storage
          .removeItemImage(previousImageKey)
          .catch(() => undefined);
      return result;
    } catch (error) {
      if (nextImageKey)
        await this.storage.removeItemImage(nextImageKey).catch(() => undefined);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("Item SKU or barcode already exists.");
      throw error;
    }
  }

  async setSupplier(actorUserId: string, itemId: string, supplierId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM items WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.item.findUnique({ where: { id: itemId } });
      if (!item || item.deletedAt)
        throw new NotFoundException("Item was not found.");
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, status: "active", deletedAt: null },
      });
      if (!supplier)
        throw new BadRequestException("Choose an active supplier.");
      await tx.item.update({
        where: { id: itemId },
        data: { defaultSupplierId: supplierId },
      });
      await this.audit(
        tx,
        actorUserId,
        "item",
        itemId,
        "setup_supplier_selected",
        {
          previousSupplierId: item.defaultSupplierId,
          supplierId,
        }
      );
      return { itemId, supplierId };
    }, txOptions);
  }

  async assignRestaurantItems(
    actorUserId: string,
    branchId: string,
    itemIds: string[],
    expectedItemIds: string[]
  ) {
    if (
      new Set(itemIds).size !== itemIds.length ||
      new Set(expectedItemIds).size !== expectedItemIds.length
    )
      throw new BadRequestException(
        "Item selections cannot contain duplicates."
      );
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId} FOR UPDATE`;
      const branch = await tx.branch.findFirst({
        where: { id: branchId, status: "active" },
      });
      if (!branch)
        throw new BadRequestException("Choose an active restaurant.");
      const existing = await tx.branchItem.findMany({
        where: { branchId },
        orderBy: { itemId: "asc" },
      });
      const active = existing.filter(entry => entry.status === "active");
      if (
        !sameIds(
          active.map(entry => entry.itemId),
          expectedItemIds
        )
      )
        throw new ConflictException(
          "Restaurant items changed; reload before saving."
        );
      const selected = new Set(itemIds);
      const current = new Set(active.map(entry => entry.itemId));
      const added = itemIds.filter(id => !current.has(id)).sort();
      // Lock items in a stable order, matching supplier-selection locking.
      for (const id of added) {
        await tx.$queryRaw`SELECT id FROM items WHERE id = ${id} FOR UPDATE`;
        const item = await tx.item.findFirst({
          where: {
            id,
            status: "active",
            deletedAt: null,
            category: { status: "active", deletedAt: null },
          },
          include: { defaultSupplier: true },
        });
        const supplier = item?.defaultSupplier;
        if (!supplier || supplier.status !== "active" || supplier.deletedAt)
          throw new BadRequestException(
            "Each selected item needs an active supplier before restaurant assignment."
          );
        const base = await tx.itemUnit.count({
          where: {
            itemId: id,
            status: "active",
            isBaseUnit: true,
            activeBaseItemId: id,
            conversionFactorToBase: 1,
            unit: { status: "active" },
          },
        });
        if (base !== 1)
          throw new BadRequestException(
            "Each selected item needs one active base unit."
          );
        const link = await tx.branchItem.upsert({
          where: { branchId_itemId: { branchId, itemId: id } },
          create: { branchId, itemId: id },
          update: { status: "active", deletedAt: null },
        });
      }
      for (const link of active.filter(entry => !selected.has(entry.itemId))) {
        await tx.branchItem.update({
          where: { id: link.id },
          data: { status: "inactive", deletedAt: new Date() },
        });
      }
      await this.audit(
        tx,
        actorUserId,
        "branch",
        branchId,
        "setup_restaurant_items_saved",
        { previousItemIds: active.map(entry => entry.itemId), itemIds }
      );
      return { branchId, itemIds };
    }, txOptions);
  }
}
