import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RecordStatus, RequestStatus } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";
import { BranchScopeService } from "./security.js";
import { PrimarySupplierTemporalService } from "./primary-supplier-temporal.service.js";
import { RequestLinePreparationService } from "./request-line-preparation.service.js";
import { RequestSubmissionService } from "./request-submission.service.js";
import { StorageService } from "./storage.service.js";

type Tx = Prisma.TransactionClient;
type ListInput = { page: number; pageSize: number; search?: string };
type CartInput = { branchItemId: string; itemUnitId: string; requestedQuantity: string | number; expectedRowVersion?: number };
type RequestLineWithDisplay = Prisma.RequestItemGetPayload<{ include: { itemSnapshot: true; itemUnitSnapshot: { include: { unit: true } } } }>;

const requestNumber = () => `REQ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;

@Injectable()
export class RequisitionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BranchScopeService) private readonly branchScopes: BranchScopeService,
    @Inject(PrimarySupplierTemporalService) private readonly primaries: PrimarySupplierTemporalService,
    @Inject(RequestLinePreparationService) private readonly lines: RequestLinePreparationService,
    @Inject(RequestSubmissionService) private readonly submissions: RequestSubmissionService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  private async assertBranch(userId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, status: RecordStatus.active } });
    if (!branch) throw new BadRequestException("The selected branch is not active.");
    await this.branchScopes.assertAllowed(userId, branchId);
    return branch;
  }

  private async assertOwnedRequest(userId: string, requestId: string) {
    const request = await this.prisma.requestRecord.findFirst({ where: { id: requestId, createdByUserId: userId } });
    if (!request) throw new NotFoundException("Request was not found.");
    await this.branchScopes.assertAllowed(userId, request.branchId);
    return request;
  }

  private localized(item: { nameAr: string; nameEn: string | null; nameUr: string | null }) {
    return { nameAr: item.nameAr, nameEn: item.nameEn ?? item.nameAr, nameUr: item.nameUr ?? item.nameAr };
  }

  private async requestableBranchItems(branchId: string, categoryId?: string, search?: string) {
    const rows = await this.prisma.branchItem.findMany({
      where: {
        branchId,
        status: RecordStatus.active,
        item: { status: RecordStatus.active, deletedAt: null, category: { status: RecordStatus.active, deletedAt: null, ...(categoryId ? { id: categoryId } : {}) } },
      },
      include: { item: { include: { category: true, itemUnits: { where: { status: RecordStatus.active }, include: { unit: true } } } } },
    });
    const result: Array<(typeof rows)[number]> = [];
    for (const row of rows) {
      if (search) {
        const needle = search.toLocaleLowerCase();
        const haystack = [row.item.sku, row.item.barcode ?? "", row.item.nameAr, row.item.nameEn ?? "", row.item.nameUr ?? ""].join(" ").toLocaleLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      if (!row.item.itemUnits.length) continue;
      if (!await this.primaries.resolveCurrentPrimary(this.prisma as unknown as Tx, row.id)) continue;
      result.push(row);
    }
    return result;
  }

  async branches(userId: string) {
    const admin = await this.prisma.userRole.findFirst({ where: { userId, role: { code: "system_admin" } } });
    const rows = await this.prisma.branch.findMany({ where: admin ? { status: RecordStatus.active } : { status: RecordStatus.active, scopes: { some: { userId } } }, orderBy: { code: "asc" } });
    return rows.map((branch) => ({ id: branch.id, code: branch.code, nameAr: branch.nameAr, nameEn: branch.nameEn }));
  }

  async categories(userId: string, branchId: string) {
    await this.assertBranch(userId, branchId);
    const items = await this.requestableBranchItems(branchId);
    const categories = new Map(items.map((row) => [row.item.categoryId, row.item.category]));
    return [...categories.values()].sort((a, b) => a.nameAr.localeCompare(b.nameAr)).map((category) => ({ id: category.id, code: category.code, nameAr: category.nameAr, nameEn: category.nameEn ?? category.nameAr }));
  }

  async catalogItems(userId: string, branchId: string, categoryId: string | undefined, input: ListInput) {
    await this.assertBranch(userId, branchId);
    const all = await this.requestableBranchItems(branchId, categoryId, input.search);
    const start = (input.page - 1) * input.pageSize;
    const pageRows = all.slice(start, start + input.pageSize);
    const data = await Promise.all(pageRows.map(async (row) => {
      const baseUnit = row.item.itemUnits.find((entry) => entry.isBaseUnit) ?? row.item.itemUnits[0];
      return {
        branchItemId: row.id,
        sku: row.item.sku,
        barcode: row.item.barcode,
        imageAvailable: Boolean(row.item.imageObjectKey),
        imageUrl: row.item.imageObjectKey ? await this.storage.signedItemImageUrl(row.item.imageObjectKey) : null,
        categoryId: row.item.categoryId,
        baseUnit: baseUnit ? {
          code: baseUnit.unit.code,
          nameAr: baseUnit.unit.nameAr,
          nameEn: baseUnit.unit.nameEn ?? baseUnit.unit.nameAr,
        } : null,
        ...this.localized(row.item),
      };
    }));
    return { page: input.page, pageSize: input.pageSize, total: all.length, data };
  }

  async units(userId: string, branchItemId: string) {
    const row = await this.prisma.branchItem.findUnique({ include: { item: { include: { itemUnits: { where: { status: RecordStatus.active }, include: { unit: true } } } } }, where: { id: branchItemId } });
    if (!row) throw new NotFoundException("Catalog item was not found.");
    await this.assertBranch(userId, row.branchId);
    if (row.status !== RecordStatus.active || row.item.status !== RecordStatus.active || row.item.deletedAt || !await this.primaries.resolveCurrentPrimary(this.prisma as unknown as Tx, row.id)) throw new BadRequestException("Catalog item is not requestable.");
    return row.item.itemUnits.map((entry) => ({ id: entry.id, code: entry.unit.code, nameAr: entry.unit.nameAr, nameEn: entry.unit.nameEn ?? entry.unit.nameAr, isBaseUnit: entry.isBaseUnit }));
  }

  async createDraft(userId: string, branchId: string) {
    await this.assertBranch(userId, branchId);
    const existing = await this.prisma.requestRecord.findFirst({
      where: { branchId, createdByUserId: userId, status: RequestStatus.draft },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) return this.prisma.$transaction((tx) => this.detailInTransaction(tx, existing.id));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const request = await tx.requestRecord.create({ data: { requestNumber: requestNumber(), branchId, createdByUserId: userId, status: RequestStatus.draft } });
          await tx.auditLog.create({ data: { actorType: "user", actorUserId: userId, entityType: "request", entityId: request.id, action: "draft_created", afterData: { branchId } } });
          return this.detailInTransaction(tx, request.id);
        }, { maxWait: 10_000, timeout: 60_000 });
      } catch (error) {
        if (attempt === 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      }
    }
    throw new ConflictException("Could not allocate a request number.");
  }

  private async lockRequest(tx: Tx, requestId: string, expectedRowVersion?: number) {
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId} FOR UPDATE`;
    const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: requestId } });
    if (expectedRowVersion !== undefined && request.rowVersion !== expectedRowVersion) throw new ConflictException("Draft changed concurrently; reload it before editing.");
    return request;
  }

  private async bumpDraftVersion(tx: Tx, requestId: string, expectedRowVersion?: number) {
    const request = await this.lockRequest(tx, requestId, expectedRowVersion);
    await this.bumpLockedRequestVersion(tx, request);
  }

  private async bumpLockedRequestVersion(tx: Tx, request: { id: string; rowVersion: number }) {
    const updated = await tx.requestRecord.updateMany({ where: { id: request.id, rowVersion: request.rowVersion }, data: { rowVersion: { increment: 1 } } });
    if (updated.count !== 1) throw new ConflictException("Draft changed concurrently; reload it before editing.");
  }

  async addOrUpdateLine(userId: string, requestId: string, input: CartInput) {
    const request = await this.assertOwnedRequest(userId, requestId);
    if (request.status !== RequestStatus.draft) throw new BadRequestException("Only a draft may be edited here.");
    return this.prisma.$transaction(async (tx) => {
      await this.bumpDraftVersion(tx, requestId, input.expectedRowVersion);
      const result = await this.lines.upsertDraftLineInTransaction(tx, { requestId, actorUserId: userId, branchItemId: input.branchItemId, itemUnitId: input.itemUnitId, requestedQuantity: input.requestedQuantity });
      return { ...(await this.detailInTransaction(tx, requestId)), lastMutation: result.created ? "created" : "updated" };
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  async editLine(userId: string, requestId: string, requestItemId: string, input: CartInput) {
    await this.assertOwnedRequest(userId, requestId);
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockRequest(tx, requestId, input.expectedRowVersion);
      if (locked.status === RequestStatus.draft) {
        await this.lines.updateDraftLineInTransaction(tx, { requestId, requestItemId, actorUserId: userId, branchItemId: input.branchItemId, itemUnitId: input.itemUnitId, requestedQuantity: input.requestedQuantity });
      } else if (locked.status === RequestStatus.returned && locked.submittedAt) {
        await this.lines.changeReturnedLineInTransaction(tx, { requestId, requestItemId, actorUserId: userId, branchItemId: input.branchItemId, itemUnitId: input.itemUnitId, requestedQuantity: input.requestedQuantity });
      } else throw new BadRequestException("Request lines are read-only in the current status.");
      await this.bumpLockedRequestVersion(tx, locked);
      return this.detailInTransaction(tx, requestId);
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  async removeLine(userId: string, requestId: string, requestItemId: string, expectedRowVersion?: number) {
    const request = await this.assertOwnedRequest(userId, requestId);
    if (request.status !== RequestStatus.draft && request.status !== RequestStatus.returned) throw new BadRequestException("Request lines are read-only in the current status.");
    return this.prisma.$transaction(async (tx) => {
      await this.bumpDraftVersion(tx, requestId, expectedRowVersion);
      await this.lines.excludeLineInTransaction(tx, { requestId, requestItemId, actorUserId: userId });
      return this.detailInTransaction(tx, requestId);
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  async addReturnedLine(userId: string, requestId: string, input: CartInput) {
    await this.assertOwnedRequest(userId, requestId);
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockRequest(tx, requestId, input.expectedRowVersion);
      if (locked.status !== RequestStatus.returned || !locked.submittedAt) throw new BadRequestException("Only a returned request may add a new line.");
      const existing = await tx.requestItem.findMany({ where: { requestId, branchItemIdSnapshot: input.branchItemId, lineStatus: "active" } });
      if (existing.length > 1) throw new ConflictException("Returned request has duplicate active item lines.");
      if (existing[0]) {
        await this.lines.changeReturnedLineInTransaction(tx, { requestId, requestItemId: existing[0].id, actorUserId: userId, branchItemId: input.branchItemId, itemUnitId: input.itemUnitId, requestedQuantity: input.requestedQuantity });
      } else await this.lines.addReturnedLineInTransaction(tx, { requestId, actorUserId: userId, branchItemId: input.branchItemId, itemUnitId: input.itemUnitId, requestedQuantity: input.requestedQuantity });
      await this.bumpLockedRequestVersion(tx, locked);
      return this.detailInTransaction(tx, requestId);
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  async submit(userId: string, requestId: string, expectedRowVersion?: number) {
    const request = await this.assertOwnedRequest(userId, requestId);
    if (request.status !== RequestStatus.draft) throw new BadRequestException("Only a draft may be submitted.");
    if (expectedRowVersion !== undefined && request.rowVersion !== expectedRowVersion) throw new ConflictException("Draft changed concurrently; reload it before submitting.");
    return this.submissions.submitFirstTime(requestId, userId);
  }

  async resubmit(userId: string, requestId: string, expectedRowVersion?: number) {
    const request = await this.assertOwnedRequest(userId, requestId);
    if (request.status !== RequestStatus.returned) throw new BadRequestException("Only a returned request may be resubmitted.");
    if (expectedRowVersion !== undefined && request.rowVersion !== expectedRowVersion) throw new ConflictException("Request changed concurrently; reload it before resubmitting.");
    return this.submissions.resubmitReturned(requestId, userId);
  }

  private lineDto(line: RequestLineWithDisplay) {
    return { id: line.id, branchItemId: line.branchItemIdSnapshot, itemId: line.itemIdSnapshot, itemUnitId: line.itemUnitIdSnapshot, item: this.localized(line.itemSnapshot), sku: line.itemSnapshot.sku, unit: { code: line.itemUnitSnapshot.unit.code, nameAr: line.itemUnitSnapshot.unit.nameAr, nameEn: line.itemUnitSnapshot.unit.nameEn ?? line.itemUnitSnapshot.unit.nameAr }, requestedQuantity: line.requestedQuantity.toString(), lineStatus: line.lineStatus, addedAfterFirstSubmission: line.addedAfterFirstSubmission };
  }

  private async detailInTransaction(tx: Tx, requestId: string) {
    const request = await tx.requestRecord.findUniqueOrThrow({ where: { id: requestId }, include: { branch: true, items: { include: { itemSnapshot: true, itemUnitSnapshot: { include: { unit: true } } }, orderBy: { id: "asc" } } } });
    return { id: request.id, requestNumber: request.requestNumber, branch: { id: request.branch.id, code: request.branch.code, nameAr: request.branch.nameAr, nameEn: request.branch.nameEn }, status: request.status, rowVersion: request.rowVersion, submittedAt: request.submittedAt, items: request.items.map((line) => this.lineDto(line)) };
  }

  async requestDetail(userId: string, requestId: string) {
    await this.assertOwnedRequest(userId, requestId);
    return this.prisma.$transaction((tx) => this.detailInTransaction(tx, requestId), { maxWait: 10_000, timeout: 60_000 });
  }

  async myRequests(userId: string, input: ListInput) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.requestRecord.count({ where: { createdByUserId: userId } }),
      this.prisma.requestRecord.findMany({ where: { createdByUserId: userId }, include: { branch: true, _count: { select: { items: { where: { lineStatus: "active" } } } } }, orderBy: { updatedAt: "desc" }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    ]);
    return { page: input.page, pageSize: input.pageSize, total, data: rows.map((row) => ({ id: row.id, requestNumber: row.requestNumber, branch: { id: row.branch.id, code: row.branch.code, nameAr: row.branch.nameAr, nameEn: row.branch.nameEn }, status: row.status, submittedAt: row.submittedAt, activeLineCount: row._count.items, rowVersion: row.rowVersion })) };
  }
}
