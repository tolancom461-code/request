import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ApprovalDecision, Prisma, RequestStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "./prisma.service.js";
import { RequestLinePreparationService } from "./request-line-preparation.service.js";
import { BranchScopeService } from "./security.js";
import { NotificationService } from "./notification.service.js";

type Tx = Prisma.TransactionClient;
export type ManagerListInput = {
  page: number;
  pageSize: number;
  search?: string;
  branchId?: string;
  submittedFrom?: Date;
  submittedTo?: Date;
  sort: "submittedAt" | "requestNumber" | "updatedAt";
  direction: "asc" | "desc";
};
type LineInput = { itemUnitId: string; requestedQuantity: string | number; expectedRowVersion: number };
type DecisionInput = { expectedRowVersion: number; comment?: string };
type ReasonDecisionInput = { expectedRowVersion: number; reason: string };

@Injectable()
export class ManagerApprovalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BranchScopeService) private readonly branchScopes: BranchScopeService,
    @Inject(RequestLinePreparationService) private readonly lines: RequestLinePreparationService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  private localized(item: { nameAr: string; nameEn: string | null; nameUr: string | null }) {
    return { nameAr: item.nameAr, nameEn: item.nameEn ?? item.nameAr, nameUr: item.nameUr ?? item.nameAr };
  }

  private async assertScopedRequest(userId: string, requestId: string) {
    const request = await this.prisma.requestRecord.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException("Request was not found.");
    await this.branchScopes.assertAllowed(userId, request.branchId);
    return request;
  }

  private async isSystemAdmin(userId: string) {
    return Boolean(await this.prisma.userRole.findFirst({ where: { userId, role: { code: "system_admin" } }, select: { userId: true } }));
  }

  private async lockRequest(tx: Tx, requestId: string, expectedRowVersion?: number) {
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId} FOR UPDATE`;
    const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: requestId } });
    if (expectedRowVersion !== undefined && request.rowVersion !== expectedRowVersion) throw new ConflictException("Request changed concurrently; reload before reviewing it.");
    return request;
  }

  private async lockScopedPendingRequest(tx: Tx, userId: string, requestId: string, expectedRowVersion: number) {
    const request = await this.lockRequest(tx, requestId, expectedRowVersion);
    await this.branchScopes.assertAllowed(userId, request.branchId);
    if (request.status !== RequestStatus.pending_approval) throw new ConflictException("Request is no longer pending manager review; reload it before acting.");
    return request;
  }

  private async bumpLockedRequestVersion(tx: Tx, request: { id: string; rowVersion: number }, data: Prisma.RequestRecordUpdateManyMutationInput = {}) {
    const claimed = await tx.requestRecord.updateMany({ where: { id: request.id, status: RequestStatus.pending_approval, rowVersion: request.rowVersion }, data: { ...data, rowVersion: { increment: 1 } } });
    if (claimed.count !== 1) throw new ConflictException("Request changed concurrently; reload before reviewing it.");
  }

  private async detailInTransaction(tx: Tx, requestId: string) {
    const request = await tx.requestRecord.findUniqueOrThrow({
      where: { id: requestId },
      include: {
        branch: true,
        createdBy: { select: { id: true, username: true, email: true } },
        items: {
          include: {
            itemSnapshot: true,
            itemUnitSnapshot: { include: { unit: true } },
          },
          orderBy: { id: "asc" },
        },
        approvals: { include: { actor: { select: { id: true, username: true } } }, orderBy: { decidedAt: "asc" } },
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
        addedAfterFirstSubmission: line.addedAfterFirstSubmission,
        exclusion: line.lineStatus === "excluded" ? { removedByUserId: line.removedByUserId, removedAt: line.removedAt, removalReason: line.removalReason } : null,
      })),
      approvals: request.approvals.map((approval) => ({ id: approval.id, decision: approval.decision, comment: approval.comment, decidedAt: approval.decidedAt, actor: approval.actor })),
      statusHistory: request.statusHistory.map((history) => ({ id: history.id, actorType: history.actorType, actor: history.actorUser, fromStatus: history.fromStatus, toStatus: history.toStatus, reason: history.reason, occurredAt: history.occurredAt })),
    };
  }

  async listPending(userId: string, input: ManagerListInput) {
    const systemAdmin = await this.isSystemAdmin(userId);
    if (input.branchId) await this.branchScopes.assertAllowed(userId, input.branchId);
    const where: Prisma.RequestRecordWhereInput = {
      status: RequestStatus.pending_approval,
      ...(systemAdmin ? {} : { branch: { scopes: { some: { userId } } } }),
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.submittedFrom || input.submittedTo ? { submittedAt: { ...(input.submittedFrom ? { gte: input.submittedFrom } : {}), ...(input.submittedTo ? { lte: input.submittedTo } : {}) } } : {}),
      ...(input.search ? {
        OR: [
          { requestNumber: { contains: input.search } },
          { branch: { code: { contains: input.search } } },
          { branch: { nameAr: { contains: input.search } } },
          { branch: { nameEn: { contains: input.search } } },
          { createdBy: { username: { contains: input.search } } },
        ],
      } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.requestRecord.count({ where }),
      this.prisma.requestRecord.findMany({
        where,
        include: { branch: true, createdBy: { select: { id: true, username: true } }, _count: { select: { items: { where: { lineStatus: "active" } } } } },
        orderBy: { [input.sort]: input.direction },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    return {
      page: input.page,
      pageSize: input.pageSize,
      total,
      data: rows.map((row) => ({ id: row.id, requestNumber: row.requestNumber, branch: { id: row.branch.id, code: row.branch.code, nameAr: row.branch.nameAr, nameEn: row.branch.nameEn }, creator: row.createdBy, status: row.status, submittedAt: row.submittedAt, activeLineCount: row._count.items, rowVersion: row.rowVersion })),
    };
  }

  async detail(userId: string, requestId: string) {
    await this.assertScopedRequest(userId, requestId);
    return this.prisma.$transaction((tx) => this.detailInTransaction(tx, requestId));
  }

  async lineUnits(userId: string, requestId: string, requestItemId: string) {
    await this.assertScopedRequest(userId, requestId);
    const line = await this.prisma.requestItem.findFirst({ where: { id: requestItemId, requestId, lineStatus: "active" } });
    if (!line) throw new NotFoundException("Active request line was not found.");
    const units = await this.prisma.itemUnit.findMany({ where: { itemId: line.itemIdSnapshot, status: "active" }, include: { unit: true }, orderBy: { isBaseUnit: "desc" } });
    return units.map((entry) => ({ id: entry.id, code: entry.unit.code, nameAr: entry.unit.nameAr, nameEn: entry.unit.nameEn ?? entry.unit.nameAr, isBaseUnit: entry.isBaseUnit }));
  }

  async updatePendingLine(userId: string, requestId: string, requestItemId: string, input: LineInput) {
    await this.assertScopedRequest(userId, requestId);
    return this.prisma.$transaction(async (tx) => {
      const request = await this.lockScopedPendingRequest(tx, userId, requestId, input.expectedRowVersion);
      await this.lines.changePendingLineInTransaction(tx, { requestId, requestItemId, itemUnitId: input.itemUnitId, requestedQuantity: input.requestedQuantity, actorUserId: userId });
      await this.bumpLockedRequestVersion(tx, request);
      return this.detailInTransaction(tx, requestId);
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  async excludePendingLine(userId: string, requestId: string, requestItemId: string, input: ReasonDecisionInput) {
    await this.assertScopedRequest(userId, requestId);
    return this.prisma.$transaction(async (tx) => {
      const request = await this.lockScopedPendingRequest(tx, userId, requestId, input.expectedRowVersion);
      await this.lines.excludePendingLineInTransaction(tx, { requestId, requestItemId, actorUserId: userId, removalReason: input.reason });
      await this.bumpLockedRequestVersion(tx, request);
      return this.detailInTransaction(tx, requestId);
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  private async validateApprovalLines(tx: Tx, requestId: string) {
    const activeLines = await tx.requestItem.findMany({ where: { requestId, lineStatus: "active" } });
    if (!activeLines.length) throw new BadRequestException("A request requires at least one active line for approval.");
    const branchItems = new Set<string>();
    for (const line of activeLines) {
      if (line.requestedQuantity.lte(0)) throw new BadRequestException("Active request line quantity must remain positive.");
      if (!line.itemIdSnapshot || !line.itemUnitIdSnapshot || !line.branchItemIdSnapshot || !line.supplierIdSnapshot || !line.branchItemSupplierIdSnapshot || !line.supplierCodeSnapshot || !line.supplierNameSnapshot) throw new BadRequestException("Active request line has an incomplete frozen snapshot.");
      if (branchItems.has(line.branchItemIdSnapshot)) throw new ConflictException("Request contains duplicate active item lines.");
      branchItems.add(line.branchItemIdSnapshot);
    }
  }

  private async recordManagerDecision(tx: Tx, input: { requestId: string; actorUserId: string; decision: ApprovalDecision; reason: string | null; fromStatus: RequestStatus; toStatus: RequestStatus; action: string; occurredAt: Date }) {
    await tx.requestApproval.create({ data: { requestId: input.requestId, actorUserId: input.actorUserId, decision: input.decision, comment: input.reason, decidedAt: input.occurredAt } });
    await tx.requestStatusHistory.create({ data: { requestId: input.requestId, actorType: ActorType.user, actorUserId: input.actorUserId, fromStatus: input.fromStatus, toStatus: input.toStatus, reason: input.reason, occurredAt: input.occurredAt } });
    await tx.auditLog.create({ data: { actorType: ActorType.user, actorUserId: input.actorUserId, entityType: "request", entityId: input.requestId, action: input.action, beforeData: { status: input.fromStatus }, afterData: { status: input.toStatus, decision: input.decision, comment: input.reason }, occurredAt: input.occurredAt } });
  }

  async approve(userId: string, requestId: string, input: DecisionInput) {
    await this.assertScopedRequest(userId, requestId);
    return this.prisma.$transaction(async (tx) => {
      const request = await this.lockScopedPendingRequest(tx, userId, requestId, input.expectedRowVersion);
      await this.validateApprovalLines(tx, requestId);
      const occurredAt = new Date();
      const comment = input.comment?.trim() || null;
      await this.recordManagerDecision(tx, { requestId, actorUserId: userId, decision: ApprovalDecision.approved, reason: comment, fromStatus: RequestStatus.pending_approval, toStatus: RequestStatus.approved, action: "manager_request_approved", occurredAt });
      await this.bumpLockedRequestVersion(tx, request, { status: RequestStatus.sent_to_warehouse, approvedAt: occurredAt, warehouseAvailableAt: occurredAt });
      await tx.requestStatusHistory.create({ data: { requestId, actorType: ActorType.system, actorUserId: null, fromStatus: RequestStatus.approved, toStatus: RequestStatus.sent_to_warehouse, reason: "manager_approval_auto_handoff", occurredAt } });
      await tx.auditLog.create({ data: { actorType: ActorType.system, actorUserId: null, entityType: "request", entityId: requestId, action: "request_sent_to_warehouse_automatically", beforeData: { status: RequestStatus.approved }, afterData: { status: RequestStatus.sent_to_warehouse, warehouseAvailableAt: occurredAt.toISOString() }, occurredAt } });
      await this.notifications.approvedAndWarehouseInTransaction(tx, requestId, occurredAt);
      return this.detailInTransaction(tx, requestId);
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  private async reasonDecision(userId: string, requestId: string, input: ReasonDecisionInput, decision: ApprovalDecision, toStatus: RequestStatus, action: string) {
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException("A manager decision reason is required.");
    await this.assertScopedRequest(userId, requestId);
    return this.prisma.$transaction(async (tx) => {
      const request = await this.lockScopedPendingRequest(tx, userId, requestId, input.expectedRowVersion);
      const occurredAt = new Date();
      await this.recordManagerDecision(tx, { requestId, actorUserId: userId, decision, reason, fromStatus: RequestStatus.pending_approval, toStatus, action, occurredAt });
      await this.bumpLockedRequestVersion(tx, request, { status: toStatus });
      await this.notifications.creatorStatusInTransaction(tx, requestId, toStatus === RequestStatus.returned ? "request.returned" : "request.rejected", toStatus === RequestStatus.returned ? "returned" : "rejected", occurredAt, reason);
      return this.detailInTransaction(tx, requestId);
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  async returnRequest(userId: string, requestId: string, input: ReasonDecisionInput) {
    return this.reasonDecision(userId, requestId, input, ApprovalDecision.returned, RequestStatus.returned, "manager_request_returned");
  }

  async reject(userId: string, requestId: string, input: ReasonDecisionInput) {
    return this.reasonDecision(userId, requestId, input, ApprovalDecision.rejected, RequestStatus.rejected, "manager_request_rejected");
  }
}
