import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RecordStatus, RequestStatus } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";

type Tx = Prisma.TransactionClient;
type NotificationListInput = { page: number; pageSize: number; state: "all" | "read" | "unread"; direction: "asc" | "desc" };
type Recipient = { id: string };
type RequestWithBranch = {
  id: string;
  requestNumber: string;
  branchId: string;
  createdByUserId: string;
  branch: { id: string; code: string; nameAr: string; nameEn: string };
};

@Injectable()
export class NotificationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async requestWithBranch(tx: Tx, requestId: string): Promise<RequestWithBranch> {
    return tx.requestRecord.findUniqueOrThrow({
      where: { id: requestId },
      select: { id: true, requestNumber: true, branchId: true, createdByUserId: true, branch: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
    });
  }

  private async activeOwner(tx: Tx, userId: string) {
    return tx.user.findFirst({ where: { id: userId, status: RecordStatus.active, deletedAt: null }, select: { id: true } });
  }

  private async scopedPermissionRecipients(tx: Tx, permissionCode: string, branchId: string): Promise<Recipient[]> {
    return tx.user.findMany({
      where: {
        status: RecordStatus.active,
        deletedAt: null,
        roles: { some: { role: { permissions: { some: { permission: { code: permissionCode } } } } } },
        OR: [
          { roles: { some: { role: { code: "system_admin" } } } },
          { branchScopes: { some: { branchId } } },
        ],
      },
      select: { id: true },
    });
  }

  private payload(request: RequestWithBranch, event: string, occurredAt: Date, route: string, reason?: string | null): Prisma.InputJsonValue {
    return {
      requestId: request.id,
      requestNumber: request.requestNumber,
      branch: { id: request.branch.id, code: request.branch.code, nameAr: request.branch.nameAr, nameEn: request.branch.nameEn },
      event,
      occurredAt: occurredAt.toISOString(),
      route,
      ...(reason ? { reason } : {}),
    };
  }

  private async create(tx: Tx, type: string, recipients: Recipient[], payload: Prisma.InputJsonValue, occurredAt: Date) {
    const recipientIds = [...new Set(recipients.map((recipient) => recipient.id))];
    if (!recipientIds.length) return 0;
    await tx.notification.createMany({ data: recipientIds.map((recipientUserId) => ({ recipientUserId, type, payload, createdAt: occurredAt })) });
    return recipientIds.length;
  }

  async pendingApprovalInTransaction(tx: Tx, requestId: string, occurredAt: Date) {
    const request = await this.requestWithBranch(tx, requestId);
    const recipients = await this.scopedPermissionRecipients(tx, "request.review", request.branchId);
    return this.create(tx, "request.pending_approval", recipients, this.payload(request, "pending_approval", occurredAt, `#/manager/requisitions/${request.id}/review`), occurredAt);
  }

  async creatorStatusInTransaction(tx: Tx, requestId: string, type: "request.returned" | "request.rejected", event: "returned" | "rejected", occurredAt: Date, reason: string | null) {
    const request = await this.requestWithBranch(tx, requestId);
    const owner = await this.activeOwner(tx, request.createdByUserId);
    return this.create(tx, type, owner ? [owner] : [], this.payload(request, event, occurredAt, "#/requisitions", reason), occurredAt);
  }

  async approvedAndWarehouseInTransaction(tx: Tx, requestId: string, occurredAt: Date) {
    const request = await this.requestWithBranch(tx, requestId);
    const owner = await this.activeOwner(tx, request.createdByUserId);
    const warehouseRecipients = await this.scopedPermissionRecipients(tx, "warehouse.process", request.branchId);
    const [creatorCount, warehouseCount] = await Promise.all([
      this.create(tx, "request.approved", owner ? [owner] : [], this.payload(request, "approved", occurredAt, "#/requisitions"), occurredAt),
      this.create(tx, "warehouse.request_available", warehouseRecipients, this.payload(request, "sent_to_warehouse", occurredAt, `#/warehouse/requests/${request.id}`), occurredAt),
    ]);
    return creatorCount + warehouseCount;
  }

  async warehouseStatusInTransaction(tx: Tx, requestId: string, status: "ready" | "dispatched" | "completed", occurredAt: Date) {
    const request = await this.requestWithBranch(tx, requestId);
    const owner = await this.activeOwner(tx, request.createdByUserId);
    const type = status === RequestStatus.ready ? "warehouse.ready" : status === RequestStatus.dispatched ? "warehouse.dispatched" : "warehouse.completed";
    return this.create(tx, type, owner ? [owner] : [], this.payload(request, status, occurredAt, "#/requisitions"), occurredAt);
  }

  async list(userId: string, input: NotificationListInput) {
    const where: Prisma.NotificationWhereInput = {
      recipientUserId: userId,
      ...(input.state === "read" ? { readAt: { not: null } } : input.state === "unread" ? { readAt: null } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({ where, orderBy: [{ createdAt: input.direction }, { id: input.direction }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    ]);
    return { items, page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) };
  }

  async unreadCount(userId: string) {
    return { unreadCount: await this.prisma.notification.count({ where: { recipientUserId: userId, readAt: null } }) };
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id: notificationId, recipientUserId: userId }, select: { id: true, readAt: true } });
    if (!notification) throw new NotFoundException("Notification was not found.");
    if (!notification.readAt) await this.prisma.notification.updateMany({ where: { id: notificationId, recipientUserId: userId, readAt: null }, data: { readAt: new Date() } });
    const current = await this.prisma.notification.findFirst({ where: { id: notificationId, recipientUserId: userId } });
    if (!current) throw new ConflictException("Notification ownership changed unexpectedly.");
    return current;
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({ where: { recipientUserId: userId, readAt: null }, data: { readAt: new Date() } });
    return { markedCount: result.count };
  }
}
