import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma, RequestStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "./prisma.service.js";
import { PrimarySupplierTemporalService } from "./primary-supplier-temporal.service.js";

type Transaction = Prisma.TransactionClient;
type SnapshotInput = { branchItemId: string; itemUnitId: string; requestedQuantity: Decimal.Value };

@Injectable()
export class RequestLinePreparationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(PrimarySupplierTemporalService) private readonly primaries: PrimarySupplierTemporalService = new PrimarySupplierTemporalService(prisma)) {}

  private async resolveSnapshot(tx: Transaction, requestId: string, input: SnapshotInput) {
    const requestedQuantity = new Decimal(input.requestedQuantity);
    if (requestedQuantity.lte(0)) throw new BadRequestException("Requested quantity must be positive.");
    const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: requestId } });
    const branchItem = await tx.branchItem.findFirst({
      where: { id: input.branchItemId, branchId: request.branchId, status: "active" },
      include: { item: true, branch: true },
    });
    if (!branchItem || branchItem.branch.status !== "active" || branchItem.item.status !== "active" || branchItem.item.deletedAt) throw new BadRequestException("The selected item is not active for the request branch.");
    const itemUnit = await tx.itemUnit.findFirst({
      where: { id: input.itemUnitId, itemId: branchItem.itemId, status: "active" },
    });
    if (!itemUnit) throw new BadRequestException("The selected unit is not active for this item.");
    const supplierRelation = await this.primaries.resolveCurrentPrimary(tx, branchItem.id);
    if (!supplierRelation) {
      throw new BadRequestException("No active primary supplier is configured for this branch item.");
    }
    return {
      requestedQuantity,
      branchItemIdSnapshot: branchItem.id,
      itemIdSnapshot: branchItem.itemId,
      itemUnitIdSnapshot: itemUnit.id,
      branchItemSupplierIdSnapshot: supplierRelation.id,
      supplierIdSnapshot: supplierRelation.supplierId,
      supplierCodeSnapshot: supplierRelation.supplier.supplierCode,
      supplierNameSnapshot: supplierRelation.supplier.supplierName,
      conversionFactorSnapshot: itemUnit.conversionFactorToBase,
      baseQuantitySnapshot: requestedQuantity.mul(itemUnit.conversionFactorToBase),
    };
  }

  async prepareSnapshotInTransaction(tx: Transaction, requestId: string, input: SnapshotInput) {
    return this.resolveSnapshot(tx, requestId, input);
  }

  async upsertDraftLineInTransaction(tx: Transaction, input: SnapshotInput & { requestId: string; actorUserId: string }) {
    const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: input.requestId } });
    if (request.status !== RequestStatus.draft || request.submittedAt) throw new BadRequestException("Only a first-submission draft may be edited.");
    const existing = await tx.requestItem.findMany({ where: { requestId: input.requestId, branchItemIdSnapshot: input.branchItemId, lineStatus: "active" } });
    if (existing.length > 1) throw new ConflictException("Draft contains duplicate active lines for the same item.");
    const snapshot = await this.resolveSnapshot(tx, input.requestId, input);
    if (existing[0]) {
      const updated = await tx.requestItem.update({ where: { id: existing[0].id }, data: snapshot });
      await tx.auditLog.create({ data: { actorType: "user", actorUserId: input.actorUserId, entityType: "request_item", entityId: updated.id, action: "draft_line_updated", beforeData: { requestedQuantity: existing[0].requestedQuantity.toString(), itemUnitId: existing[0].itemUnitIdSnapshot }, afterData: { requestedQuantity: updated.requestedQuantity.toString(), itemUnitId: updated.itemUnitIdSnapshot } } });
      return { line: updated, created: false };
    }
    const created = await tx.requestItem.create({ data: { requestId: input.requestId, ...snapshot } });
    await tx.auditLog.create({ data: { actorType: "user", actorUserId: input.actorUserId, entityType: "request_item", entityId: created.id, action: "draft_line_added", afterData: { requestedQuantity: created.requestedQuantity.toString(), itemUnitId: created.itemUnitIdSnapshot } } });
    return { line: created, created: true };
  }

  async updateDraftLineInTransaction(tx: Transaction, input: SnapshotInput & { requestId: string; requestItemId: string; actorUserId: string }) {
    const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: input.requestId } });
    if (request.status !== RequestStatus.draft || request.submittedAt) throw new BadRequestException("Only a first-submission draft may be edited.");
    const line = await tx.requestItem.findFirst({ where: { id: input.requestItemId, requestId: input.requestId, lineStatus: "active" } });
    if (!line) throw new BadRequestException("Active request line was not found.");
    const snapshot = await this.resolveSnapshot(tx, input.requestId, input);
    const updated = await tx.requestItem.update({ where: { id: line.id }, data: snapshot });
    await tx.auditLog.create({ data: { actorType: "user", actorUserId: input.actorUserId, entityType: "request_item", entityId: line.id, action: "draft_line_updated", beforeData: { requestedQuantity: line.requestedQuantity.toString(), itemUnitId: line.itemUnitIdSnapshot }, afterData: { requestedQuantity: updated.requestedQuantity.toString(), itemUnitId: updated.itemUnitIdSnapshot } } });
    return updated;
  }

  async excludeLineInTransaction(tx: Transaction, input: { requestId: string; requestItemId: string; actorUserId: string; removalReason?: string }) {
    const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: input.requestId } });
    if (request.status !== RequestStatus.draft && (request.status !== RequestStatus.returned || !request.submittedAt)) throw new BadRequestException("Only draft or returned request lines may be excluded.");
    const line = await tx.requestItem.findFirst({ where: { id: input.requestItemId, requestId: input.requestId, lineStatus: "active" } });
    if (!line) throw new BadRequestException("Active request line was not found.");
    const removalReason = input.removalReason ?? (request.submittedAt ? "returned_request_line_removed" : "removed_before_first_submission");
    const updated = await tx.requestItem.update({ where: { id: line.id }, data: { lineStatus: "excluded", removedByUserId: input.actorUserId, removedAt: new Date(), removalReason } });
    await tx.auditLog.create({ data: { actorType: "user", actorUserId: input.actorUserId, entityType: "request_item", entityId: line.id, action: "request_line_excluded", beforeData: { lineStatus: "active" }, afterData: { lineStatus: "excluded", removalReason } } });
    return updated;
  }

  async createDraftLine(input: SnapshotInput & { requestId: string; actorUserId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: input.requestId } });
      if (request.status !== RequestStatus.draft || request.submittedAt) {
        throw new BadRequestException("A draft line may be added only before first submission.");
      }
      // Draft values are provisional; authoritative values are refreshed at submission.
      const snapshot = await this.resolveSnapshot(tx, input.requestId, input);
      return tx.requestItem.create({ data: { requestId: input.requestId, ...snapshot } });
    });
  }

  async refreshAuthoritativeSnapshots(tx: Transaction, requestId: string) {
    const activeLines = await tx.requestItem.findMany({ where: { requestId, lineStatus: "active" } });
    if (!activeLines.length) throw new BadRequestException("A request requires at least one active line.");
    const changes: Array<{ id: string; before: Record<string, string>; after: Record<string, string> }> = [];
    for (const line of activeLines) {
      const before = {
        branchItemIdSnapshot: line.branchItemIdSnapshot,
        itemUnitIdSnapshot: line.itemUnitIdSnapshot,
        supplierIdSnapshot: line.supplierIdSnapshot,
        supplierCodeSnapshot: line.supplierCodeSnapshot,
        supplierNameSnapshot: line.supplierNameSnapshot,
        conversionFactorSnapshot: line.conversionFactorSnapshot.toString(),
        baseQuantitySnapshot: line.baseQuantitySnapshot.toString(),
      };
      const snapshot = await this.resolveSnapshot(tx, requestId, {
        branchItemId: line.branchItemIdSnapshot,
        itemUnitId: line.itemUnitIdSnapshot,
        requestedQuantity: line.requestedQuantity,
      });
      await tx.requestItem.update({ where: { id: line.id }, data: snapshot });
      changes.push({
        id: line.id,
        before,
        after: {
          branchItemIdSnapshot: snapshot.branchItemIdSnapshot,
          itemUnitIdSnapshot: snapshot.itemUnitIdSnapshot,
          supplierIdSnapshot: snapshot.supplierIdSnapshot,
          supplierCodeSnapshot: snapshot.supplierCodeSnapshot,
          supplierNameSnapshot: snapshot.supplierNameSnapshot,
          conversionFactorSnapshot: snapshot.conversionFactorSnapshot.toString(),
          baseQuantitySnapshot: snapshot.baseQuantitySnapshot.toString(),
        },
      });
    }
    return changes;
  }

  private async requireReturnedRequest(tx: Transaction, requestId: string) {
    const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: requestId } });
    if (request.status !== RequestStatus.returned || !request.submittedAt) {
      throw new BadRequestException("Only a previously submitted returned request may be edited.");
    }
    return request;
  }

  async changeReturnedLineInTransaction(tx: Transaction, input: SnapshotInput & { requestId: string; requestItemId: string; actorUserId: string }) {
    await this.requireReturnedRequest(tx, input.requestId);
    const quantity = new Decimal(input.requestedQuantity);
    if (quantity.lte(0)) throw new BadRequestException("Requested quantity must be positive.");
    const line = await tx.requestItem.findFirst({ where: { id: input.requestItemId, requestId: input.requestId, lineStatus: "active" } });
    if (!line) throw new BadRequestException("Active request line was not found.");
    if (input.branchItemId !== line.branchItemIdSnapshot) throw new BadRequestException("The selected item does not match the returned request line.");
    const validUnit = await tx.itemUnit.findFirst({ where: { id: input.itemUnitId, itemId: line.itemIdSnapshot, status: "active" } });
    if (!validUnit) throw new BadRequestException("The selected unit is not active for this item.");
    const updated = await tx.requestItem.update({
      where: { id: line.id },
      data: {
        requestedQuantity: quantity,
        itemUnitIdSnapshot: validUnit.id,
        conversionFactorSnapshot: validUnit.conversionFactorToBase,
        baseQuantitySnapshot: quantity.mul(validUnit.conversionFactorToBase),
      },
    });
    await tx.auditLog.create({
      data: {
        actorType: "user",
        actorUserId: input.actorUserId,
        entityType: "request_item",
        entityId: line.id,
        action: "returned_line_updated",
        beforeData: { requestedQuantity: line.requestedQuantity.toString(), itemUnitId: line.itemUnitIdSnapshot, conversionFactor: line.conversionFactorSnapshot.toString() },
        afterData: { requestedQuantity: quantity.toString(), itemUnitId: validUnit.id, conversionFactor: validUnit.conversionFactorToBase.toString() },
      },
    });
    return updated;
  }

  async changePendingLineInTransaction(tx: Transaction, input: { requestId: string; requestItemId: string; itemUnitId: string; requestedQuantity: Decimal.Value; actorUserId: string }) {
    const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: input.requestId } });
    if (request.status !== RequestStatus.pending_approval) throw new BadRequestException("Only pending request lines may be reviewed.");
    const quantity = new Decimal(input.requestedQuantity);
    if (quantity.lte(0)) throw new BadRequestException("Requested quantity must be positive.");
    const line = await tx.requestItem.findFirst({ where: { id: input.requestItemId, requestId: input.requestId, lineStatus: "active" } });
    if (!line) throw new BadRequestException("Active request line was not found.");
    const validUnit = await tx.itemUnit.findFirst({ where: { id: input.itemUnitId, itemId: line.itemIdSnapshot, status: "active" } });
    if (!validUnit) throw new BadRequestException("The selected unit is not active for this item.");
    const updated = await tx.requestItem.update({
      where: { id: line.id },
      data: {
        requestedQuantity: quantity,
        itemUnitIdSnapshot: validUnit.id,
        conversionFactorSnapshot: validUnit.conversionFactorToBase,
        baseQuantitySnapshot: quantity.mul(validUnit.conversionFactorToBase),
      },
    });
    await tx.auditLog.create({
      data: {
        actorType: "user",
        actorUserId: input.actorUserId,
        entityType: "request_item",
        entityId: line.id,
        action: "manager_pending_line_updated",
        beforeData: { requestedQuantity: line.requestedQuantity.toString(), itemUnitId: line.itemUnitIdSnapshot, conversionFactor: line.conversionFactorSnapshot.toString() },
        afterData: { requestedQuantity: quantity.toString(), itemUnitId: validUnit.id, conversionFactor: validUnit.conversionFactorToBase.toString() },
      },
    });
    return updated;
  }

  async excludePendingLineInTransaction(tx: Transaction, input: { requestId: string; requestItemId: string; actorUserId: string; removalReason: string }) {
    const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: input.requestId } });
    if (request.status !== RequestStatus.pending_approval) throw new BadRequestException("Only pending request lines may be excluded.");
    const removalReason = input.removalReason.trim();
    if (!removalReason) throw new BadRequestException("A line exclusion reason is required.");
    const line = await tx.requestItem.findFirst({ where: { id: input.requestItemId, requestId: input.requestId, lineStatus: "active" } });
    if (!line) throw new BadRequestException("Active request line was not found.");
    const removedAt = new Date();
    const updated = await tx.requestItem.update({ where: { id: line.id }, data: { lineStatus: "excluded", removedByUserId: input.actorUserId, removedAt, removalReason } });
    await tx.auditLog.create({
      data: {
        actorType: "user",
        actorUserId: input.actorUserId,
        entityType: "request_item",
        entityId: line.id,
        action: "manager_pending_line_excluded",
        beforeData: { lineStatus: line.lineStatus, requestedQuantity: line.requestedQuantity.toString(), itemUnitId: line.itemUnitIdSnapshot },
        afterData: { lineStatus: "excluded", removedAt: removedAt.toISOString(), removalReason },
      },
    });
    return updated;
  }

  // Legacy helper retained for accepted Phase 2A service-level callers. The P-005-C1 HTTP
  // mutation path deliberately does not call it: RequisitionService passes its locked Tx
  // to changeReturnedLineInTransaction so quantity and unit are one business mutation.
  async changeReturnedLineQuantity(input: { requestId: string; requestItemId: string; requestedQuantity: Decimal.Value; actorUserId: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireReturnedRequest(tx, input.requestId);
      const quantity = new Decimal(input.requestedQuantity);
      if (quantity.lte(0)) throw new BadRequestException("Requested quantity must be positive.");
      const line = await tx.requestItem.findFirst({ where: { id: input.requestItemId, requestId: input.requestId, lineStatus: "active" } });
      if (!line) throw new BadRequestException("Active request line was not found.");
      const updated = await tx.requestItem.update({ where: { id: line.id }, data: { requestedQuantity: quantity } });
      await tx.auditLog.create({ data: { actorType: "user", actorUserId: input.actorUserId, entityType: "request_item", entityId: line.id, action: "returned_line_quantity_changed", beforeData: { requestedQuantity: line.requestedQuantity.toString() }, afterData: { requestedQuantity: quantity.toString() } } });
      return updated;
    });
  }

  // Legacy helper retained for accepted Phase 2A service-level callers; see the note above.
  async changeReturnedLineUnit(input: { requestId: string; requestItemId: string; itemUnitId: string; actorUserId: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireReturnedRequest(tx, input.requestId);
      const line = await tx.requestItem.findFirst({ where: { id: input.requestItemId, requestId: input.requestId, lineStatus: "active" } });
      if (!line) throw new BadRequestException("Active request line was not found.");
      const validUnit = await tx.itemUnit.findFirst({ where: { id: input.itemUnitId, itemId: line.itemIdSnapshot, status: "active" } });
      if (!validUnit) throw new BadRequestException("The selected unit is not active for this item.");
      const updated = await tx.requestItem.update({ where: { id: line.id }, data: { itemUnitIdSnapshot: validUnit.id } });
      await tx.auditLog.create({ data: { actorType: "user", actorUserId: input.actorUserId, entityType: "request_item", entityId: line.id, action: "returned_line_unit_changed", beforeData: { itemUnitId: line.itemUnitIdSnapshot }, afterData: { itemUnitId: validUnit.id } } });
      return updated;
    });
  }

  async excludeLine(input: { requestId: string; requestItemId: string; actorUserId: string; removalReason?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: input.requestId } });
      if (request.status !== RequestStatus.draft && (request.status !== RequestStatus.returned || !request.submittedAt)) {
        throw new BadRequestException("Only draft or returned request lines may be excluded.");
      }
      const line = await tx.requestItem.findFirst({ where: { id: input.requestItemId, requestId: input.requestId, lineStatus: "active" } });
      if (!line) throw new BadRequestException("Active request line was not found.");
      const removalReason = input.removalReason ?? (request.submittedAt ? "returned_request_line_removed" : "removed_before_first_submission");
      const updated = await tx.requestItem.update({ where: { id: line.id }, data: { lineStatus: "excluded", removedByUserId: input.actorUserId, removedAt: new Date(), removalReason } });
      await tx.auditLog.create({ data: { actorType: "user", actorUserId: input.actorUserId, entityType: "request_item", entityId: line.id, action: "request_line_excluded", beforeData: { lineStatus: "active" }, afterData: { lineStatus: "excluded", removalReason } } });
      return updated;
    });
  }

  async addReturnedLineInTransaction(tx: Transaction, input: SnapshotInput & { requestId: string; actorUserId: string }) {
    await this.requireReturnedRequest(tx, input.requestId);
    const snapshot = await this.resolveSnapshot(tx, input.requestId, input);
    const created = await tx.requestItem.create({ data: { requestId: input.requestId, ...snapshot, addedAfterFirstSubmission: true, addedByUserId: input.actorUserId, addedAt: new Date() } });
    await tx.auditLog.create({ data: { actorType: "user", actorUserId: input.actorUserId, entityType: "request_item", entityId: created.id, action: "returned_line_added", afterData: { addedAfterFirstSubmission: true, requestedQuantity: snapshot.requestedQuantity.toString() } } });
    return created;
  }

  // Legacy root transaction wrapper; the P-005-C1 HTTP path uses addReturnedLineInTransaction.
  async addReturnedLine(input: SnapshotInput & { requestId: string; actorUserId: string }) {
    return this.prisma.$transaction((tx) => this.addReturnedLineInTransaction(tx, input));
  }
}
