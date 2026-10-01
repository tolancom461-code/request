import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RecordStatus } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";

type Transaction = Prisma.TransactionClient;
const MAX_EFFECTIVE_DATE = new Date("9999-12-31T00:00:00.000Z");

@Injectable()
export class PrimarySupplierTemporalService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  asOfDate(value: Date = new Date()) {
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }

  async lockBranchItem(tx: Transaction, branchItemId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM branch_items WHERE id = ${branchItemId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Branch item was not found.");
  }

  async assertNoOverlappingActivePrimary(tx: Transaction, branchItemId: string, effectiveFrom: Date, effectiveTo: Date | null, exceptRelationId?: string) {
    await this.lockBranchItem(tx, branchItemId);
    const overlap = await tx.branchItemSupplier.findFirst({
      where: {
        branchItemId,
        status: RecordStatus.active,
        isPrimary: true,
        ...(exceptRelationId ? { id: { not: exceptRelationId } } : {}),
        effectiveFrom: { lte: effectiveTo ?? MAX_EFFECTIVE_DATE },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
      select: { id: true },
    });
    if (overlap) throw new ConflictException("Active primary supplier effective-date windows may not overlap for a branch item.");
  }

  async resolveCurrentPrimary(tx: Transaction, branchItemId: string, asOf: Date = new Date()) {
    const date = this.asOfDate(asOf);
    const rows = await tx.branchItemSupplier.findMany({
      where: {
        branchItemId,
        status: RecordStatus.active,
        isPrimary: true,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
        supplier: { is: { status: RecordStatus.active, deletedAt: null } },
        branchItem: { is: { status: RecordStatus.active, branch: { is: { status: RecordStatus.active } }, item: { is: { status: RecordStatus.active, deletedAt: null } } } },
      },
      include: { supplier: true },
      orderBy: { effectiveFrom: "asc" },
    });
    if (rows.length > 1) throw new ConflictException("Multiple current effective primary suppliers violate the branch item invariant.");
    return rows[0] ?? null;
  }

  async reconcileGuard(tx: Transaction, branchItemId: string, asOf: Date = new Date()) {
    await this.lockBranchItem(tx, branchItemId);
    await tx.branchItemSupplier.updateMany({ where: { branchItemId, activePrimaryBranchItemId: branchItemId }, data: { activePrimaryBranchItemId: null } });
    const current = await this.resolveCurrentPrimary(tx, branchItemId, asOf);
    if (!current) return null;
    await tx.branchItemSupplier.update({ where: { id: current.id }, data: { activePrimaryBranchItemId: branchItemId } });
    return current;
  }
}
