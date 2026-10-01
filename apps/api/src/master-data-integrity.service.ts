import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma, RecordStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "./prisma.service.js";
import { PrimarySupplierTemporalService } from "./primary-supplier-temporal.service.js";

type Transaction = Prisma.TransactionClient;
const txOptions = { maxWait: 10_000, timeout: 60_000 };

@Injectable()
export class MasterDataIntegrityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(PrimarySupplierTemporalService) private readonly primaries: PrimarySupplierTemporalService = new PrimarySupplierTemporalService(prisma)) {}

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
        const existing = await tx.itemUnit.findFirst({ where: { itemId: input.itemId, activeBaseItemId: input.itemId } });
        if (existing) throw new BadRequestException("An active base unit already exists for this item.");
      }
      return tx.itemUnit.create({ data: { ...input, conversionFactorToBase, activeBaseItemId: input.isBaseUnit && input.status === RecordStatus.active ? input.itemId : null } });
    }, txOptions);
  }

  async replaceActiveBaseUnit(input: { previousItemUnitId: string; nextItemUnitId: string }) {
    return this.prisma.$transaction(async (tx: Transaction) => {
      const [previous, next] = await Promise.all([tx.itemUnit.findUniqueOrThrow({ where: { id: input.previousItemUnitId } }), tx.itemUnit.findUniqueOrThrow({ where: { id: input.nextItemUnitId } })]);
      if (previous.itemId !== next.itemId || !next.conversionFactorToBase.equals(1)) throw new BadRequestException("Replacement base unit must belong to the same item and have factor 1.");
      await tx.itemUnit.update({ where: { id: previous.id }, data: { status: RecordStatus.inactive, isBaseUnit: false, activeBaseItemId: null } });
      return tx.itemUnit.update({ where: { id: next.id }, data: { status: RecordStatus.active, isBaseUnit: true, activeBaseItemId: next.itemId } });
    }, txOptions);
  }

  async createBranchItemSupplier(input: { branchItemId: string; supplierId: string; isPrimary: boolean; status: RecordStatus; effectiveFrom: Date; effectiveTo?: Date }) {
    return this.prisma.$transaction(async (tx) => {
      if (input.isPrimary && input.status === RecordStatus.active) await this.primaries.assertNoOverlappingActivePrimary(tx, input.branchItemId, input.effectiveFrom, input.effectiveTo ?? null);
      const row = await tx.branchItemSupplier.create({ data: { ...input, activePrimaryBranchItemId: null } });
      await this.primaries.reconcileGuard(tx, input.branchItemId);
      return tx.branchItemSupplier.findUniqueOrThrow({ where: { id: row.id } });
    }, txOptions);
  }

  async replaceActivePrimarySupplier(input: { previousRelationId: string; nextRelationId: string }) {
    return this.prisma.$transaction(async (tx: Transaction) => {
      const [previous, next] = await Promise.all([tx.branchItemSupplier.findUniqueOrThrow({ where: { id: input.previousRelationId } }), tx.branchItemSupplier.findUniqueOrThrow({ where: { id: input.nextRelationId } })]);
      if (previous.branchItemId !== next.branchItemId) throw new BadRequestException("Primary supplier replacement must belong to the same branch item.");
      await tx.branchItemSupplier.update({ where: { id: previous.id }, data: { status: RecordStatus.inactive, isPrimary: false, activePrimaryBranchItemId: null, effectiveTo: new Date() } });
      await this.primaries.assertNoOverlappingActivePrimary(tx, next.branchItemId, next.effectiveFrom, next.effectiveTo, next.id);
      const row = await tx.branchItemSupplier.update({ where: { id: next.id }, data: { status: RecordStatus.active, isPrimary: true, activePrimaryBranchItemId: null } });
      await this.primaries.reconcileGuard(tx, next.branchItemId);
      return tx.branchItemSupplier.findUniqueOrThrow({ where: { id: row.id } });
    }, txOptions);
  }
}
