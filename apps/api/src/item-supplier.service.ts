import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class ItemSupplierService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveForBranchItem(
    tx: Prisma.TransactionClient,
    branchItemId: string
  ) {
    const link = await tx.branchItem.findFirst({
      where: {
        id: branchItemId,
        status: "active",
        deletedAt: null,
        branch: { is: { status: "active" } },
        item: {
          is: {
            status: "active",
            deletedAt: null,
            category: { is: { status: "active", deletedAt: null } },
          },
        },
      },
      include: { item: { include: { defaultSupplier: true } } },
    });
    const supplier = link?.item.defaultSupplier;
    return supplier?.status === "active" && !supplier.deletedAt
      ? { supplierId: supplier.id, supplier }
      : null;
  }
}
