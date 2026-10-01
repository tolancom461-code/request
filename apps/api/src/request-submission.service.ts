import { BadRequestException, ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { ActorType, Prisma, RequestStatus } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";
import { RequestLinePreparationService } from "./request-line-preparation.service.js";
import { NotificationService } from "./notification.service.js";

type Transaction = Prisma.TransactionClient;

@Injectable()
export class RequestSubmissionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(RequestLinePreparationService) private readonly lines: RequestLinePreparationService, @Optional() @Inject(NotificationService) private readonly notifications?: NotificationService) {}

  private async transition(tx: Transaction, input: { requestId: string; actorUserId: string; expectedStatus: RequestStatus; action: string; preserveSubmittedAt: boolean }) {
    const request = await tx.requestRecord.findUnique({ where: { id: input.requestId } });
    if (!request || request.status !== input.expectedStatus || (input.preserveSubmittedAt && !request.submittedAt) || (!input.preserveSubmittedAt && request.submittedAt)) {
      throw new BadRequestException("Request is not eligible for this submission transition.");
    }
    const snapshotChanges = await this.lines.refreshAuthoritativeSnapshots(tx, input.requestId);
    const occurredAt = new Date();
    const claimed = await tx.requestRecord.updateMany({
      where: { id: request.id, status: input.expectedStatus, rowVersion: request.rowVersion, submittedAt: input.preserveSubmittedAt ? { not: null } : null },
      data: input.preserveSubmittedAt ? { status: RequestStatus.pending_approval, rowVersion: { increment: 1 } } : { status: RequestStatus.pending_approval, submittedAt: occurredAt, rowVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new ConflictException("Request submission was changed concurrently; retry with fresh state.");
    await tx.requestStatusHistory.create({ data: { requestId: request.id, actorType: ActorType.user, actorUserId: input.actorUserId, fromStatus: input.expectedStatus, toStatus: RequestStatus.pending_approval, occurredAt } });
    await tx.auditLog.create({ data: { actorType: ActorType.user, actorUserId: input.actorUserId, entityType: "request", entityId: request.id, action: input.action, beforeData: { status: input.expectedStatus, submittedAt: request.submittedAt?.toISOString() ?? null, snapshots: snapshotChanges.map((change) => ({ id: change.id, snapshot: change.before })) }, afterData: { status: RequestStatus.pending_approval, submittedAt: request.submittedAt?.toISOString() ?? occurredAt.toISOString(), snapshots: snapshotChanges.map((change) => ({ id: change.id, snapshot: change.after })) }, occurredAt } });
    await this.notifications?.pendingApprovalInTransaction(tx, request.id, occurredAt);
    return tx.requestRecord.findUniqueOrThrow({ where: { id: request.id } });
  }

  async submitFirstTime(requestId: string, actorUserId: string) {
    return this.prisma.$transaction(
      (tx) => this.transition(tx, { requestId, actorUserId, expectedStatus: RequestStatus.draft, action: "first_submitted", preserveSubmittedAt: false }),
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  async resubmitReturned(requestId: string, actorUserId: string) {
    return this.prisma.$transaction(
      (tx) => this.transition(tx, { requestId, actorUserId, expectedStatus: RequestStatus.returned, action: "returned_request_resubmitted", preserveSubmittedAt: true }),
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  async recordSystemEvent(requestId: string, toStatus: RequestStatus, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: requestId } });
      const occurredAt = new Date();
      await tx.requestStatusHistory.create({ data: { requestId, actorType: ActorType.system, actorUserId: null, fromStatus: request.status, toStatus, reason, occurredAt } });
      return tx.auditLog.create({ data: { actorType: ActorType.system, actorUserId: null, entityType: "request", entityId: requestId, action: "system_status_event", afterData: { toStatus, reason }, occurredAt } });
    });
  }
}
