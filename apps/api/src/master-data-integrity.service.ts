import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma, RecordStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "./prisma.service.js";

type Transaction = Prisma.TransactionClient;
const txOptions = { maxWait: 10_000, timeout: 60_000 };

export async function assertBaseUnitCanChange(tx: Transaction, itemId: string) {
  const usedItem = await tx.item.findFirst({
    where: { id: itemId, OR: [
      { snapshots: { some: { request: { status: { not: "draft" } } } } },
      { openingPurchases: { some: {} } },
    ] },
    select: { id: true },
  });
  if (usedItem) throw new BadRequestException("The base unit cannot be changed after a request submission or opening purchase for this item.");
}

@Injectable()
export class MasterDataIntegrityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private validateUnit(input: { conversionFactorToBase: Decimal.Value; isBaseUnit: boolean }) {
    const conversionFactorToBase = new Decimal(input.conversionFactorToBase);
    if (conversionFactorToBase.lte(0)) throw new BadRequestException("Conversion factor must be positive.");
    if (input.isBaseUnit && !conversionFactorToBase.equals(1)) throw new BadRequestException("The base unit conversion factor must equal 1.");
    return conversionFactorToBase;
  }

  async createItemUnit(input: { itemId: string; unitId: string; conversionFactorToBase: Decimal.Value; isBaseUnit: boolean; status: RecordStatus }) {
    const conversionFactorToBase = this.validateUnit(input);
    return this.prisma.$transaction(async (tx) => {
      if (input.isBaseUnit && input.status === RecordStatus.active) {
        await tx.$queryRaw`SELECT id FROM items WHERE id = ${input.itemId} FOR UPDATE`;
        const existing = await tx.itemUnit.findFirst({ where: { itemId: input.itemId, activeBaseItemId: input.itemId } });
        if (existing) throw new BadRequestException("An active base unit already exists for this item.");
        await assertBaseUnitCanChange(tx, input.itemId);
      }
      return tx.itemUnit.create({ data: { ...input, conversionFactorToBase, activeBaseItemId: input.isBaseUnit && input.status === RecordStatus.active ? input.itemId : null } });
    }, { ...txOptions, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async replaceActiveBaseUnit(input: { previousItemUnitId: string; nextItemUnitId: string }) {
    return this.prisma.$transaction(async (tx: Transaction) => {
      const { itemId } = await tx.itemUnit.findUniqueOrThrow({ where: { id: input.previousItemUnitId }, select: { itemId: true } });
      await tx.$queryRaw`SELECT id FROM items WHERE id = ${itemId} FOR UPDATE`;
      const [previous, next] = await Promise.all([tx.itemUnit.findUniqueOrThrow({ where: { id: input.previousItemUnitId } }), tx.itemUnit.findUniqueOrThrow({ where: { id: input.nextItemUnitId } })]);
      if (previous.itemId !== next.itemId || !next.conversionFactorToBase.equals(1)) throw new BadRequestException("Replacement base unit must belong to the same item and have factor 1.");
      if (previous.id !== next.id) await assertBaseUnitCanChange(tx, previous.itemId);
      await tx.itemUnit.update({ where: { id: previous.id }, data: { status: RecordStatus.inactive, isBaseUnit: false, activeBaseItemId: null } });
      return tx.itemUnit.update({ where: { id: next.id }, data: { status: RecordStatus.active, isBaseUnit: true, activeBaseItemId: next.itemId } });
    }, { ...txOptions, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

}
