import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, Prisma, RequestLineStatus, RequestStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "./prisma.service.js";
import { BranchScopeService } from "./security.js";
import { NotificationService } from "./notification.service.js";

type Tx = Prisma.TransactionClient;
const warehouseStatuses = [RequestStatus.sent_to_warehouse, RequestStatus.preparing, RequestStatus.ready, RequestStatus.dispatched, RequestStatus.completed] as const;
const actionableStatuses = [RequestStatus.sent_to_warehouse, RequestStatus.preparing, RequestStatus.ready, RequestStatus.dispatched] as const;
type WarehouseStatus = (typeof warehouseStatuses)[number];
export type WarehouseGroupBy = "request" | "branch" | "supplier" | "item";
type GroupLine = {
  requestId: string;
  requestNumber: string;
  requestStatus: string;
  branch: { id: string; code: string; nameAr: string; nameEn: string };
  item: { id: string; sku: string; nameAr: string; nameEn: string; nameUr: string };
  supplierSnapshot: { id: string; code: string; name: string };
  unit: { id: string; code: string; nameAr: string; nameEn: string };
  requestedQuantity: string;
  conversionFactorSnapshot: string;
  baseQuantitySnapshot: string;
};
type GroupEntry = { key: string; label: Record<string, string>; totalBase: Decimal; requestIds: Set<string>; lines: GroupLine[] };
export type WarehouseListInput = {
  page: number;
  pageSize: number;
  search?: string;
  branchId?: string;
  supplierId?: string;
  itemId?: string;
  statuses?: WarehouseStatus[];
  warehouseFrom?: Date;
  warehouseTo?: Date;
  submittedFrom?: Date;
  submittedTo?: Date;
  updatedFrom?: Date;
  updatedTo?: Date;
  sort: "warehouseAvailableAt" | "submittedAt" | "updatedAt" | "requestNumber";
  direction: "asc" | "desc";
};

@Injectable()
export class WarehouseOperationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BranchScopeService) private readonly branchScopes: BranchScopeService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  private localized(item: { nameAr: string; nameEn: string | null; nameUr: string | null }) {
    return { nameAr: item.nameAr, nameEn: item.nameEn ?? item.nameAr, nameUr: item.nameUr ?? item.nameAr };
  }

  private async isSystemAdmin(userId: string) {
    return Boolean(await this.prisma.userRole.findFirst({ where: { userId, role: { code: "system_admin" } }, select: { userId: true } }));
  }

  private async assertScopedWarehouseRequest(userId: string, requestId: string) {
    const request = await this.prisma.requestRecord.findUnique({ where: { id: requestId } });
    if (!request || !warehouseStatuses.includes(request.status as WarehouseStatus)) throw new NotFoundException("Warehouse request was not found.");
    await this.branchScopes.assertAllowed(userId, request.branchId);
    return request;
  }

  private async lockRequest(tx: Tx, requestId: string, expectedRowVersion?: number) {
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId} FOR UPDATE`;
    const request = await tx.requestRecord.findUnique({ where: { id: requestId } });
    if (!request || !warehouseStatuses.includes(request.status as WarehouseStatus)) throw new NotFoundException("Warehouse request was not found.");
    if (expectedRowVersion !== undefined && request.rowVersion !== expectedRowVersion) throw new ConflictException("Request changed concurrently; reload before processing it.");
    return request;
  }

  private async lockScopedTransitionRequest(tx: Tx, userId: string, requestId: string, expectedRowVersion: number, from: WarehouseStatus) {
    const request = await this.lockRequest(tx, requestId, expectedRowVersion);
    await this.branchScopes.assertAllowed(userId, request.branchId);
    if (request.status !== from) throw new ConflictException("Request is not in the required warehouse state; reload before processing it.");
    return request;
  }

  private async validateOperationalLines(tx: Tx, requestId: string) {
    const lines = await tx.requestItem.findMany({ where: { requestId, lineStatus: RequestLineStatus.active } });
    if (!lines.length) throw new BadRequestException("A warehouse request requires at least one active line.");
    for (const line of lines) {
      if (line.requestedQuantity.lte(0) || line.baseQuantitySnapshot.lte(0) || line.conversionFactorSnapshot.lte(0)) throw new BadRequestException("Active warehouse line snapshots must remain positive.");
      if (!line.itemIdSnapshot || !line.itemUnitIdSnapshot || !line.branchItemIdSnapshot || !line.supplierIdSnapshot || !line.supplierCodeSnapshot || !line.supplierNameSnapshot) throw new BadRequestException("Active warehouse line has an incomplete frozen snapshot.");
    }
    return lines;
  }

  private async detailInTransaction(tx: Tx, requestId: string) {
    const request = await tx.requestRecord.findUniqueOrThrow({
      where: { id: requestId },
      include: {
        branch: true,
        createdBy: { select: { id: true, username: true, email: true } },
        items: { include: { itemSnapshot: true, itemUnitSnapshot: { include: { unit: true } } }, orderBy: { id: "asc" } },
        statusHistory: { include: { actorUser: { select: { id: true, username: true } } }, orderBy: { occurredAt: "asc" } },
      },
    });
    return {
      id: request.id,
      requestNumber: request.requestNumber,
      branch: { id: request.branch.id, code: request.branch.code, nameAr: request.branch.nameAr, nameEn: request.branch.nameEn },
      creator: request.createdBy,
      status: request.status,
      rowVersion: request.rowVersion,
      submittedAt: request.submittedAt,
      approvedAt: request.approvedAt,
      warehouseAvailableAt: request.warehouseAvailableAt,
      items: request.items.map((line) => ({
        id: line.id,
        branchItemId: line.branchItemIdSnapshot,
        itemId: line.itemIdSnapshot,
        item: this.localized(line.itemSnapshot),
        sku: line.itemSnapshot.sku,
        itemUnitId: line.itemUnitIdSnapshot,
        unit: { code: line.itemUnitSnapshot.unit.code, nameAr: line.itemUnitSnapshot.unit.nameAr, nameEn: line.itemUnitSnapshot.unit.nameEn ?? line.itemUnitSnapshot.unit.nameAr },
        requestedQuantity: line.requestedQuantity.toString(),
        conversionFactorSnapshot: line.conversionFactorSnapshot.toString(),
        baseQuantitySnapshot: line.baseQuantitySnapshot.toString(),
        supplierSnapshot: { id: line.supplierIdSnapshot, code: line.supplierCodeSnapshot, name: line.supplierNameSnapshot },
        lineStatus: line.lineStatus,
        exclusion: line.lineStatus === RequestLineStatus.excluded ? { removedByUserId: line.removedByUserId, removedAt: line.removedAt, removalReason: line.removalReason } : null,
      })),
      statusHistory: request.statusHistory.map((history) => ({ id: history.id, actorType: history.actorType, actor: history.actorUser, fromStatus: history.fromStatus, toStatus: history.toStatus, reason: history.reason, occurredAt: history.occurredAt })),
    };
  }

  private async whereFor(userId: string, input: WarehouseListInput): Promise<Prisma.RequestRecordWhereInput> {
    const systemAdmin = await this.isSystemAdmin(userId);
    if (input.branchId) await this.branchScopes.assertAllowed(userId, input.branchId);
    const statuses = input.statuses?.length ? input.statuses : [...actionableStatuses];
    return {
      status: { in: statuses },
      ...(systemAdmin ? {} : { branch: { scopes: { some: { userId } } } }),
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.supplierId ? { items: { some: { lineStatus: RequestLineStatus.active, supplierIdSnapshot: input.supplierId } } } : {}),
      ...(input.itemId ? { items: { some: { lineStatus: RequestLineStatus.active, itemIdSnapshot: input.itemId } } } : {}),
      ...(input.warehouseFrom || input.warehouseTo ? { warehouseAvailableAt: { ...(input.warehouseFrom ? { gte: input.warehouseFrom } : {}), ...(input.warehouseTo ? { lte: input.warehouseTo } : {}) } } : {}),
      ...(input.submittedFrom || input.submittedTo ? { submittedAt: { ...(input.submittedFrom ? { gte: input.submittedFrom } : {}), ...(input.submittedTo ? { lte: input.submittedTo } : {}) } } : {}),
      ...(input.updatedFrom || input.updatedTo ? { updatedAt: { ...(input.updatedFrom ? { gte: input.updatedFrom } : {}), ...(input.updatedTo ? { lte: input.updatedTo } : {}) } } : {}),
      ...(input.search ? {
        OR: [
          { requestNumber: { contains: input.search } },
          { branch: { code: { contains: input.search } } },
          { branch: { nameAr: { contains: input.search } } },
          { branch: { nameEn: { contains: input.search } } },
          { items: { some: { lineStatus: RequestLineStatus.active, itemSnapshot: { sku: { contains: input.search } } } } },
          { items: { some: { lineStatus: RequestLineStatus.active, supplierCodeSnapshot: { contains: input.search } } } },
        ],
      } : {}),
    };
  }

  async list(userId: string, input: WarehouseListInput) {
    const where = await this.whereFor(userId, input);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.requestRecord.count({ where }),
      this.prisma.requestRecord.findMany({
        where,
        include: { branch: true, createdBy: { select: { id: true, username: true } }, _count: { select: { items: { where: { lineStatus: RequestLineStatus.active } } } } },
        orderBy: { [input.sort]: input.direction } as Prisma.RequestRecordOrderByWithRelationInput,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    return {
      page: input.page,
      pageSize: input.pageSize,
      total,
      data: rows.map((row) => ({ id: row.id, requestNumber: row.requestNumber, branch: { id: row.branch.id, code: row.branch.code, nameAr: row.branch.nameAr, nameEn: row.branch.nameEn }, creator: row.createdBy, status: row.status, submittedAt: row.submittedAt, approvedAt: row.approvedAt, warehouseAvailableAt: row.warehouseAvailableAt, updatedAt: row.updatedAt, activeLineCount: row._count.items, rowVersion: row.rowVersion })),
    };
  }

  async groups(userId: string, input: WarehouseListInput, groupBy: WarehouseGroupBy) {
    const where = await this.whereFor(userId, input);
    const requests = await this.prisma.requestRecord.findMany({
      where,
      include: {
        branch: true,
        items: { where: { lineStatus: RequestLineStatus.active }, include: { itemSnapshot: true, itemUnitSnapshot: { include: { unit: true } } }, orderBy: { id: "asc" } },
      },
      orderBy: { [input.sort]: input.direction } as Prisma.RequestRecordOrderByWithRelationInput,
    });
    const grouped = new Map<string, GroupEntry>();
    for (const request of requests) {
      for (const line of request.items) {
        const group: { key: string; label: Record<string, string> } = groupBy === "branch"
          ? { key: request.branch.id, label: { code: request.branch.code, nameAr: request.branch.nameAr, nameEn: request.branch.nameEn ?? request.branch.nameAr } }
          : groupBy === "supplier"
            ? { key: line.supplierIdSnapshot, label: { code: line.supplierCodeSnapshot, name: line.supplierNameSnapshot } }
            : groupBy === "item"
              ? { key: line.itemIdSnapshot, label: { sku: line.itemSnapshot.sku, ...this.localized(line.itemSnapshot) } }
              : { key: request.id, label: { requestNumber: request.requestNumber, branchCode: request.branch.code, status: String(request.status) } };
        const target: GroupEntry = grouped.get(group.key) ?? { key: group.key, label: group.label, totalBase: new Decimal(0), requestIds: new Set<string>(), lines: [] };
        target.totalBase = target.totalBase.plus(line.baseQuantitySnapshot);
        target.requestIds.add(request.id);
        target.lines.push({
          requestId: request.id,
          requestNumber: request.requestNumber,
          requestStatus: request.status,
          branch: { id: request.branch.id, code: request.branch.code, nameAr: request.branch.nameAr, nameEn: request.branch.nameEn },
          item: { id: line.itemIdSnapshot, sku: line.itemSnapshot.sku, ...this.localized(line.itemSnapshot) },
          supplierSnapshot: { id: line.supplierIdSnapshot, code: line.supplierCodeSnapshot, name: line.supplierNameSnapshot },
          unit: { id: line.itemUnitIdSnapshot, code: line.itemUnitSnapshot.unit.code, nameAr: line.itemUnitSnapshot.unit.nameAr, nameEn: line.itemUnitSnapshot.unit.nameEn ?? line.itemUnitSnapshot.unit.nameAr },
          requestedQuantity: line.requestedQuantity.toString(),
          conversionFactorSnapshot: line.conversionFactorSnapshot.toString(),
          baseQuantitySnapshot: line.baseQuantitySnapshot.toString(),
        });
        grouped.set(group.key, target);
      }
    }
    return {
      groupBy,
      data: [...grouped.values()].map((entry) => ({ key: entry.key, label: entry.label, requestCount: entry.requestIds.size, lineCount: entry.lines.length, totalBaseQuantity: entry.totalBase.toString(), lines: entry.lines })).sort((a, b) => String(a.key).localeCompare(String(b.key))),
    };
  }

  async detail(userId: string, requestId: string) {
    await this.assertScopedWarehouseRequest(userId, requestId);
    return this.prisma.$transaction((tx) => this.detailInTransaction(tx, requestId));
  }

  private async transition(userId: string, requestId: string, expectedRowVersion: number, from: WarehouseStatus, to: WarehouseStatus, action: string) {
    await this.assertScopedWarehouseRequest(userId, requestId);
    return this.prisma.$transaction(async (tx) => {
      const request = await this.lockScopedTransitionRequest(tx, userId, requestId, expectedRowVersion, from);
      const activeLines = await this.validateOperationalLines(tx, requestId);
      const occurredAt = new Date();
      const claimed = await tx.requestRecord.updateMany({ where: { id: request.id, status: from, rowVersion: request.rowVersion }, data: { status: to, rowVersion: { increment: 1 } } });
      if (claimed.count !== 1) throw new ConflictException("Request changed concurrently; reload before processing it.");
      await tx.requestStatusHistory.create({ data: { requestId, actorType: ActorType.user, actorUserId: userId, fromStatus: from, toStatus: to, reason: null, occurredAt } });
      await tx.auditLog.create({ data: { actorType: ActorType.user, actorUserId: userId, entityType: "request", entityId: requestId, action, beforeData: { status: from, rowVersion: request.rowVersion }, afterData: { status: to, rowVersion: request.rowVersion + 1, activeLineCount: activeLines.length }, occurredAt } });
      if (to === RequestStatus.ready || to === RequestStatus.dispatched || to === RequestStatus.completed) await this.notifications.warehouseStatusInTransaction(tx, requestId, to, occurredAt);
      return this.detailInTransaction(tx, requestId);
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  startPreparation(userId: string, requestId: string, expectedRowVersion: number) { return this.transition(userId, requestId, expectedRowVersion, RequestStatus.sent_to_warehouse, RequestStatus.preparing, "warehouse_preparation_started"); }
  markReady(userId: string, requestId: string, expectedRowVersion: number) { return this.transition(userId, requestId, expectedRowVersion, RequestStatus.preparing, RequestStatus.ready, "warehouse_request_marked_ready"); }
  dispatch(userId: string, requestId: string, expectedRowVersion: number) { return this.transition(userId, requestId, expectedRowVersion, RequestStatus.ready, RequestStatus.dispatched, "warehouse_request_dispatched"); }
  complete(userId: string, requestId: string, expectedRowVersion: number) { return this.transition(userId, requestId, expectedRowVersion, RequestStatus.dispatched, RequestStatus.completed, "warehouse_request_completed"); }
}
