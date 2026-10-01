import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Prisma, RequestLineStatus, RequestStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "./prisma.service.js";
import { BranchScopeService } from "./security.js";

export type ReportInput = {
  from: Date;
  to: Date;
  branchId?: string;
  statuses?: RequestStatus[];
  search?: string;
  page: number;
  pageSize: number;
  sort: "submittedAt" | "requestNumber" | "status" | "branch" | "baseQuantity";
  direction: "asc" | "desc";
};

export type ExportReport = "requests" | "branches" | "items" | "suppliers" | "status-lifecycle" | "approvals" | "warehouse";

type Scope = { isSystemAdmin: boolean; branchIds: string[] };
type History = { requestId?: string; toStatus: RequestStatus; fromStatus?: RequestStatus | null; occurredAt: Date };
const statuses = Object.values(RequestStatus);
const terminal = new Set<RequestStatus>([RequestStatus.completed, RequestStatus.rejected]);
const csvDangerous = /^[=+\-@]/;

const decimal = (value: Decimal | string | number) => new Decimal(value).toString();
const percentage = (numerator: number, denominator: number) => denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
const average = (values: number[]) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;
const durationMinutes = (from?: Date | null, to?: Date | null) => from && to && to >= from ? (to.getTime() - from.getTime()) / 60_000 : null;

@Injectable()
export class ReportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BranchScopeService) private readonly branchScopes: BranchScopeService,
  ) {}

  private async scopeFor(userId: string, requestedBranchId?: string): Promise<Scope> {
    const isSystemAdmin = Boolean(await this.prisma.userRole.findFirst({ where: { userId, role: { code: "system_admin" } }, select: { userId: true } }));
    if (requestedBranchId) await this.branchScopes.assertAllowed(userId, requestedBranchId);
    if (isSystemAdmin) return { isSystemAdmin, branchIds: [] };
    const branchIds = (await this.prisma.userBranchScope.findMany({ where: { userId }, select: { branchId: true } })).map((entry) => entry.branchId);
    return { isSystemAdmin, branchIds };
  }

  private assertPeriod(input: ReportInput) {
    if (input.to < input.from) throw new BadRequestException("The report end date must be on or after the start date.");
    if (input.to.getTime() - input.from.getTime() > 366 * 24 * 60 * 60 * 1000) throw new BadRequestException("The reporting period may not exceed 366 days.");
  }

  private scopedBranchFilter(scope: Scope, branchId?: string): Prisma.RequestRecordWhereInput {
    if (branchId) return { branchId };
    if (scope.isSystemAdmin) return {};
    return scope.branchIds.length ? { branchId: { in: scope.branchIds } } : { id: "__no_authorized_branches__" };
  }

  private requestWhere(scope: Scope, input: ReportInput): Prisma.RequestRecordWhereInput {
    return {
      ...this.scopedBranchFilter(scope, input.branchId),
      submittedAt: { not: null, gte: input.from, lte: input.to },
      ...(input.statuses?.length ? { status: { in: input.statuses } } : {}),
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
  }

  private historyPeriodWhere(scope: Scope, input: ReportInput): Prisma.RequestStatusHistoryWhereInput {
    return {
      occurredAt: { gte: input.from, lte: input.to },
      request: this.scopedBranchFilter(scope, input.branchId),
    };
  }

  private sortedHistory(history: History[]) {
    return [...history].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  private lifecycleDurations(history: History[]) {
    const timeline = this.sortedHistory(history);
    const firstPending = timeline.find((entry) => entry.toStatus === RequestStatus.pending_approval)?.occurredAt ?? null;
    const firstApproval = timeline.find((entry) => entry.toStatus === RequestStatus.approved)?.occurredAt ?? null;
    const sent = timeline.find((entry) => entry.toStatus === RequestStatus.sent_to_warehouse)?.occurredAt ?? null;
    const completed = timeline.find((entry) => entry.toStatus === RequestStatus.completed)?.occurredAt ?? null;
    return {
      firstPending,
      firstApproval,
      sent,
      completed,
      approvalMinutes: durationMinutes(firstPending, firstApproval),
      warehouseMinutes: durationMinutes(sent, completed),
      endToEndMinutes: durationMinutes(firstPending, completed),
    };
  }

  private async requestRecords(userId: string, input: ReportInput) {
    this.assertPeriod(input);
    const scope = await this.scopeFor(userId, input.branchId);
    return { scope, where: this.requestWhere(scope, input) };
  }

  async filterOptions(userId: string) {
    const scope = await this.scopeFor(userId);
    const branches = await this.prisma.branch.findMany({
      where: scope.isSystemAdmin ? { status: "active" } : { id: { in: scope.branchIds }, status: "active" },
      select: { id: true, code: true, nameAr: true, nameEn: true },
      orderBy: { code: "asc" },
    });
    return { branches, statuses };
  }

  async dashboard(userId: string, input: ReportInput) {
    const { scope, where } = await this.requestRecords(userId, input);
    const requests = await this.prisma.requestRecord.findMany({
      where,
      select: {
        id: true, status: true, submittedAt: true,
        items: { where: { lineStatus: RequestLineStatus.active }, select: { baseQuantitySnapshot: true } },
        statusHistory: { select: { requestId: true, toStatus: true, fromStatus: true, occurredAt: true }, orderBy: { occurredAt: "asc" } },
      },
    });
    const statusCounts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<RequestStatus, number>;
    let totalBase = new Decimal(0);
    const approvalMinutes: number[] = [];
    const warehouseMinutes: number[] = [];
    const endToEndMinutes: number[] = [];
    const returnedRequests = new Set<string>();
    const rejectedRequests = new Set<string>();
    for (const request of requests) {
      statusCounts[request.status] += 1;
      for (const line of request.items) totalBase = totalBase.plus(line.baseQuantitySnapshot);
      const timing = this.lifecycleDurations(request.statusHistory);
      if (timing.approvalMinutes !== null) approvalMinutes.push(timing.approvalMinutes);
      if (timing.warehouseMinutes !== null) warehouseMinutes.push(timing.warehouseMinutes);
      if (timing.endToEndMinutes !== null) endToEndMinutes.push(timing.endToEndMinutes);
      for (const event of request.statusHistory) {
        if (event.toStatus === RequestStatus.returned) returnedRequests.add(request.id);
        if (event.toStatus === RequestStatus.rejected) rejectedRequests.add(request.id);
      }
    }
    const submitted = requests.length;
    return {
      scope: { branchId: input.branchId ?? null, branchCount: scope.isSystemAdmin ? null : scope.branchIds.length },
      period: { from: input.from, to: input.to, basis: "request.submittedAt (first submission timestamp)" },
      kpis: {
        submittedRequests: submitted,
        currentStatusCounts: statusCounts,
        totalActiveRequestedBaseQuantity: decimal(totalBase),
        completionRate: percentage(statusCounts.completed, submitted),
        returnRate: percentage(returnedRequests.size, submitted),
        rejectionRate: percentage(rejectedRequests.size, submitted),
        averageApprovalCycleMinutes: average(approvalMinutes),
        averageWarehouseProcessingMinutes: average(warehouseMinutes),
        averageEndToEndCompletionMinutes: average(endToEndMinutes),
      },
      metricDefinitions: {
        completionRate: "completed current requests divided by requests first submitted in the selected period",
        returnRate: "distinct requests with at least one returned transition divided by requests first submitted in the selected period",
        rejectionRate: "distinct requests with at least one rejected transition divided by requests first submitted in the selected period",
        timing: "minutes derived only from ordered RequestStatusHistory transitions; invalid or incomplete sequences are omitted",
      },
    };
  }

  async requests(userId: string, input: ReportInput) {
    const { where } = await this.requestRecords(userId, input);
    const sort: Prisma.RequestRecordOrderByWithRelationInput = input.sort === "requestNumber" ? { requestNumber: input.direction } : input.sort === "status" ? { status: input.direction } : input.sort === "branch" ? { branch: { code: input.direction } } : { submittedAt: input.direction };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.requestRecord.count({ where }),
      this.prisma.requestRecord.findMany({
        where, orderBy: sort, skip: (input.page - 1) * input.pageSize, take: input.pageSize,
        include: {
          branch: { select: { id: true, code: true, nameAr: true, nameEn: true } },
          createdBy: { select: { id: true, username: true } },
          items: { select: { lineStatus: true, baseQuantitySnapshot: true } },
          statusHistory: { select: { toStatus: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 1 },
        },
      }),
    ]);
    return {
      page: input.page, pageSize: input.pageSize, total,
      data: rows.map((request) => {
        const active = request.items.filter((line) => line.lineStatus === RequestLineStatus.active);
        const excluded = request.items.length - active.length;
        return {
          id: request.id, requestNumber: request.requestNumber, branch: request.branch, creator: request.createdBy,
          currentStatus: request.status, submittedAt: request.submittedAt, approvedAt: request.approvedAt,
          warehouseAvailableAt: request.warehouseAvailableAt,
          completedAt: request.statusHistory[0]?.toStatus === RequestStatus.completed ? request.statusHistory[0].occurredAt : null,
          activeLineCount: active.length, excludedLineCount: excluded,
          activeBaseQuantity: decimal(active.reduce((sum, line) => sum.plus(line.baseQuantitySnapshot), new Decimal(0))),
          latestLifecycleEvent: request.statusHistory[0] ?? null,
        };
      }),
    };
  }

  async branches(userId: string, input: ReportInput) {
    const { where } = await this.requestRecords(userId, input);
    const rows = await this.prisma.requestRecord.findMany({
      where,
      include: { branch: { select: { id: true, code: true, nameAr: true, nameEn: true } }, items: { where: { lineStatus: RequestLineStatus.active }, select: { baseQuantitySnapshot: true } }, statusHistory: { select: { requestId: true, toStatus: true, fromStatus: true, occurredAt: true }, orderBy: { occurredAt: "asc" } } },
    });
    const groups = new Map<string, { branch: typeof rows[number]["branch"]; requests: typeof rows; base: Decimal; completedDurations: number[] }>();
    for (const row of rows) {
      const group = groups.get(row.branchId) ?? { branch: row.branch, requests: [], base: new Decimal(0), completedDurations: [] };
      group.requests.push(row);
      for (const line of row.items) group.base = group.base.plus(line.baseQuantitySnapshot);
      const duration = this.lifecycleDurations(row.statusHistory).endToEndMinutes;
      if (duration !== null) group.completedDurations.push(duration);
      groups.set(row.branchId, group);
    }
    return {
      data: [...groups.values()].map((group) => {
        const count = group.requests.length;
        const current = (status: RequestStatus) => group.requests.filter((entry) => entry.status === status).length;
        return { branch: group.branch, requestCount: count, completedCount: current(RequestStatus.completed), pendingCount: current(RequestStatus.pending_approval), returnedCount: current(RequestStatus.returned), rejectedCount: current(RequestStatus.rejected), completionRate: percentage(current(RequestStatus.completed), count), totalActiveBaseQuantity: decimal(group.base), averageEndToEndCompletionMinutes: average(group.completedDurations) };
      }).sort((a, b) => a.branch.code.localeCompare(b.branch.code)),
    };
  }

  async items(userId: string, input: ReportInput) {
    const { where } = await this.requestRecords(userId, input);
    const lines = await this.prisma.requestItem.findMany({
      where: { lineStatus: RequestLineStatus.active, request: where },
      include: { request: { select: { id: true, branch: { select: { id: true, code: true, nameAr: true, nameEn: true } } } }, itemSnapshot: { select: { id: true, sku: true, nameAr: true, nameEn: true, nameUr: true } }, itemUnitSnapshot: { include: { unit: { select: { code: true } } } } },
    });
    const groups = new Map<string, { item: typeof lines[number]["itemSnapshot"]; requests: Set<string>; lines: number; base: Decimal; units: Map<string, Decimal>; branches: Map<string, { code: string; count: number; base: Decimal }> }>();
    for (const line of lines) {
      const group = groups.get(line.itemIdSnapshot) ?? { item: line.itemSnapshot, requests: new Set(), lines: 0, base: new Decimal(0), units: new Map(), branches: new Map() };
      group.requests.add(line.requestId); group.lines += 1; group.base = group.base.plus(line.baseQuantitySnapshot);
      group.units.set(line.itemUnitSnapshot.unit.code, (group.units.get(line.itemUnitSnapshot.unit.code) ?? new Decimal(0)).plus(line.requestedQuantity));
      const branch = group.branches.get(line.request.branch.id) ?? { code: line.request.branch.code, count: 0, base: new Decimal(0) };
      branch.count += 1; branch.base = branch.base.plus(line.baseQuantitySnapshot); group.branches.set(line.request.branch.id, branch); groups.set(line.itemIdSnapshot, group);
    }
    return { data: [...groups.values()].map((group) => ({ item: { id: group.item.id, sku: group.item.sku, nameAr: group.item.nameAr, nameEn: group.item.nameEn ?? group.item.nameAr, nameUr: group.item.nameUr ?? group.item.nameAr, displayMetadataSource: "current item master for safe display only" }, requestCount: group.requests.size, activeLineCount: group.lines, requestedQuantityByUnit: [...group.units.entries()].map(([unitCode, quantity]) => ({ unitCode, quantity: decimal(quantity) })), totalBaseQuantity: decimal(group.base), branches: [...group.branches.values()].map((branch) => ({ code: branch.code, activeLineCount: branch.count, totalBaseQuantity: decimal(branch.base) })) })).sort((a, b) => a.item.sku.localeCompare(b.item.sku)) };
  }

  async suppliers(userId: string, input: ReportInput) {
    const { where } = await this.requestRecords(userId, input);
    const lines = await this.prisma.requestItem.findMany({ where: { lineStatus: RequestLineStatus.active, request: where }, include: { request: { select: { id: true, status: true, branch: { select: { id: true, code: true } } } } } });
    const groups = new Map<string, { id: string; code: string; name: string; requests: Set<string>; lines: number; base: Decimal; statuses: Map<string, number>; branches: Map<string, Decimal> }>();
    for (const line of lines) {
      const group = groups.get(line.supplierIdSnapshot) ?? { id: line.supplierIdSnapshot, code: line.supplierCodeSnapshot, name: line.supplierNameSnapshot, requests: new Set(), lines: 0, base: new Decimal(0), statuses: new Map(), branches: new Map() };
      group.requests.add(line.requestId); group.lines += 1; group.base = group.base.plus(line.baseQuantitySnapshot);
      group.statuses.set(line.request.status, (group.statuses.get(line.request.status) ?? 0) + 1);
      group.branches.set(line.request.branch.code, (group.branches.get(line.request.branch.code) ?? new Decimal(0)).plus(line.baseQuantitySnapshot)); groups.set(line.supplierIdSnapshot, group);
    }
    return { data: [...groups.values()].map((group) => ({ supplierSnapshot: { id: group.id, code: group.code, name: group.name }, associatedRequestCount: group.requests.size, activeLineCount: group.lines, totalBaseQuantity: decimal(group.base), currentStatusDistribution: Object.fromEntries(group.statuses), branches: [...group.branches.entries()].map(([code, total]) => ({ code, totalBaseQuantity: decimal(total) })) })).sort((a, b) => a.supplierSnapshot.code.localeCompare(b.supplierSnapshot.code)) };
  }

  async statusLifecycle(userId: string, input: ReportInput) {
    this.assertPeriod(input);
    const scope = await this.scopeFor(userId, input.branchId);
    const currentWhere: Prisma.RequestRecordWhereInput = { ...this.scopedBranchFilter(scope, input.branchId), submittedAt: { not: null, gte: input.from, lte: input.to } };
    const historyWhere = this.historyPeriodWhere(scope, input);
    const [current, transitions] = await this.prisma.$transaction([
      this.prisma.requestRecord.groupBy({ by: ["status"], where: currentWhere, orderBy: { status: "asc" }, _count: { _all: true } }),
      this.prisma.requestStatusHistory.findMany({ where: historyWhere, select: { requestId: true, toStatus: true, fromStatus: true, occurredAt: true }, orderBy: { occurredAt: "asc" } }),
    ]);
    const currentCounts = new Map(current.map((row) => [row.status, Number(((row._count as unknown) as { _all?: number })._all ?? 0)]));
    const currentStatusDistribution = Object.fromEntries(statuses.map((status) => [status, currentCounts.get(status) ?? 0]));
    const transitionCounts = Object.fromEntries(statuses.map((status) => [status, transitions.filter((entry) => entry.toStatus === status).length]));
    const perRequest = new Map<string, History[]>();
    for (const event of transitions) perRequest.set(event.requestId, [...(perRequest.get(event.requestId) ?? []), event]);
    const approval = [...perRequest.values()].map((history) => this.lifecycleDurations(history).approvalMinutes).filter((value): value is number => value !== null);
    const warehouse = [...perRequest.values()].map((history) => this.lifecycleDurations(history).warehouseMinutes).filter((value): value is number => value !== null);
    return { period: { from: input.from, to: input.to, currentStateBasis: "submittedAt", transitionBasis: "RequestStatusHistory.occurredAt" }, currentStatusDistribution, transitionEventCounts: transitionCounts, approvalCycleEventCount: transitions.filter((entry) => entry.toStatus === RequestStatus.approved).length, averageApprovalCycleMinutes: average(approval), averageWarehouseProcessingMinutes: average(warehouse), funnel: { submitted: Object.values(currentStatusDistribution).reduce((sum, value) => sum + Number(value), 0), approvedEvents: transitionCounts.approved, sentToWarehouseEvents: transitionCounts.sent_to_warehouse, completedEvents: transitionCounts.completed } };
  }

  async approvals(userId: string, input: ReportInput) {
    this.assertPeriod(input);
    const scope = await this.scopeFor(userId, input.branchId);
    const rows = await this.prisma.requestApproval.findMany({
      where: { decidedAt: { gte: input.from, lte: input.to }, request: this.scopedBranchFilter(scope, input.branchId) },
      include: {
        actor: { select: { id: true, username: true } },
        request: {
          include: {
            branch: { select: { id: true, code: true, nameAr: true, nameEn: true } },
            statusHistory: { select: { toStatus: true, occurredAt: true }, orderBy: { occurredAt: "asc" } },
          },
        },
      },
      orderBy: { decidedAt: "desc" },
    });
    const managers = new Map<string, { actor: { id: string; username: string }; approved: number; returned: number; rejected: number; durations: number[] }>();
    const branches = new Map<string, { branch: { id: string; code: string; nameAr: string; nameEn: string }; approved: number; returned: number; rejected: number }>();
    for (const row of rows) {
      const timing = this.lifecycleDurations(row.request.statusHistory).approvalMinutes;
      const manager = managers.get(row.actorUserId) ?? { actor: row.actor, approved: 0, returned: 0, rejected: 0, durations: [] };
      manager[row.decision] += 1;
      if (row.decision === "approved" && timing !== null) manager.durations.push(timing);
      managers.set(row.actorUserId, manager);
      const branch = branches.get(row.request.branchId) ?? { branch: row.request.branch, approved: 0, returned: 0, rejected: 0 }; branch[row.decision] += 1; branches.set(row.request.branchId, branch);
    }
    const approved = rows.filter((row) => row.decision === "approved").length;
    const returned = rows.filter((row) => row.decision === "returned").length;
    const rejected = rows.filter((row) => row.decision === "rejected").length;
    return { basis: "decision events in RequestApproval.decidedAt; duration is first pending-to-approved history sequence when valid", decisionCounts: { approved, returned, rejected, total: rows.length, returnRate: percentage(returned, rows.length), rejectionRate: percentage(rejected, rows.length) }, byManager: [...managers.values()].map((entry) => ({ actor: entry.actor, approved: entry.approved, returned: entry.returned, rejected: entry.rejected, averageApprovalCycleMinutes: average(entry.durations) })), byBranch: [...branches.values()] };
  }

  async warehouse(userId: string, input: ReportInput) {
    this.assertPeriod(input);
    const scope = await this.scopeFor(userId, input.branchId);
    const reached = await this.prisma.requestStatusHistory.findMany({ where: { ...this.historyPeriodWhere(scope, input), toStatus: RequestStatus.sent_to_warehouse }, select: { requestId: true } });
    const requestIds = [...new Set(reached.map((entry) => entry.requestId))];
    if (!requestIds.length) return { period: { from: input.from, to: input.to, basis: "sent_to_warehouse transition occurredAt" }, counts: { sentToWarehouse: 0, preparingEvents: 0, readyEvents: 0, dispatchedEvents: 0, completedEvents: 0 }, averageWarehouseCycleMinutes: null, branches: [], suppliers: [], items: [] };
    const rows = await this.prisma.requestRecord.findMany({ where: { id: { in: requestIds }, ...this.scopedBranchFilter(scope, input.branchId) }, include: { branch: { select: { code: true } }, items: { where: { lineStatus: RequestLineStatus.active }, include: { itemSnapshot: { select: { sku: true, nameAr: true, nameEn: true, nameUr: true } } } }, statusHistory: { select: { toStatus: true, occurredAt: true }, orderBy: { occurredAt: "asc" } } } });
    const eventCounts = { sentToWarehouse: 0, preparingEvents: 0, readyEvents: 0, dispatchedEvents: 0, completedEvents: 0 };
    const cycles: number[] = []; const branchTotals = new Map<string, number>(); const supplierTotals = new Map<string, Decimal>(); const itemTotals = new Map<string, { sku: string; nameAr: string; nameEn: string; nameUr: string; base: Decimal }>();
    for (const row of rows) {
      branchTotals.set(row.branch.code, (branchTotals.get(row.branch.code) ?? 0) + 1);
      const timing = this.lifecycleDurations(row.statusHistory); if (timing.warehouseMinutes !== null) cycles.push(timing.warehouseMinutes);
      for (const event of row.statusHistory) { if (event.toStatus === RequestStatus.sent_to_warehouse) eventCounts.sentToWarehouse += 1; if (event.toStatus === RequestStatus.preparing) eventCounts.preparingEvents += 1; if (event.toStatus === RequestStatus.ready) eventCounts.readyEvents += 1; if (event.toStatus === RequestStatus.dispatched) eventCounts.dispatchedEvents += 1; if (event.toStatus === RequestStatus.completed) eventCounts.completedEvents += 1; }
      for (const line of row.items) { supplierTotals.set(`${line.supplierCodeSnapshot}|${line.supplierNameSnapshot}`, (supplierTotals.get(`${line.supplierCodeSnapshot}|${line.supplierNameSnapshot}`) ?? new Decimal(0)).plus(line.baseQuantitySnapshot)); const item = itemTotals.get(line.itemIdSnapshot) ?? { sku: line.itemSnapshot.sku, nameAr: line.itemSnapshot.nameAr, nameEn: line.itemSnapshot.nameEn ?? line.itemSnapshot.nameAr, nameUr: line.itemSnapshot.nameUr ?? line.itemSnapshot.nameAr, base: new Decimal(0) }; item.base = item.base.plus(line.baseQuantitySnapshot); itemTotals.set(line.itemIdSnapshot, item); }
    }
    return { period: { from: input.from, to: input.to, basis: "sent_to_warehouse transition occurredAt" }, counts: eventCounts, averageWarehouseCycleMinutes: average(cycles), branches: [...branchTotals.entries()].map(([code, requestCount]) => ({ code, requestCount })), suppliers: [...supplierTotals.entries()].map(([label, totalBaseQuantity]) => ({ snapshot: label, totalBaseQuantity: decimal(totalBaseQuantity) })), items: [...itemTotals.values()].map((item) => ({ ...item, totalBaseQuantity: decimal(item.base), base: undefined })) };
  }

  async exportRows(userId: string, report: ExportReport, input: ReportInput) {
    let rows: Array<Record<string, string | number | null>>;
    if (report === "requests") {
      const source = await this.requests(userId, { ...input, page: 1, pageSize: 5_000 });
      rows = source.data.map((row) => ({ requestNumber: row.requestNumber, branchCode: row.branch.code, creator: row.creator.username, currentStatus: row.currentStatus, submittedAt: row.submittedAt?.toISOString() ?? "", approvedAt: row.approvedAt?.toISOString() ?? "", warehouseAvailableAt: row.warehouseAvailableAt?.toISOString() ?? "", activeLineCount: row.activeLineCount, excludedLineCount: row.excludedLineCount, activeBaseQuantity: row.activeBaseQuantity }));
    } else if (report === "branches") {
      const source = await this.branches(userId, input);
      rows = source.data.map((row) => ({ branchCode: row.branch.code, requestCount: row.requestCount, completedCount: row.completedCount, pendingCount: row.pendingCount, returnedCount: row.returnedCount, rejectedCount: row.rejectedCount, completionRate: row.completionRate, totalActiveBaseQuantity: row.totalActiveBaseQuantity, averageEndToEndCompletionMinutes: row.averageEndToEndCompletionMinutes ?? "N/A" }));
    } else if (report === "items") {
      const source = await this.items(userId, input);
      rows = source.data.map((row) => ({ sku: row.item.sku, itemName: row.item.nameAr, requestCount: row.requestCount, activeLineCount: row.activeLineCount, totalBaseQuantity: row.totalBaseQuantity }));
    } else if (report === "suppliers") {
      const source = await this.suppliers(userId, input);
      rows = source.data.map((row) => ({ supplierCodeSnapshot: row.supplierSnapshot.code, supplierNameSnapshot: row.supplierSnapshot.name, associatedRequestCount: row.associatedRequestCount, activeLineCount: row.activeLineCount, totalBaseQuantity: row.totalBaseQuantity }));
    } else if (report === "status-lifecycle") {
      const source = await this.statusLifecycle(userId, input);
      rows = Object.entries(source.transitionEventCounts).map(([status, eventCount]) => ({ status, eventCount, currentStatusCount: Number(source.currentStatusDistribution[status as RequestStatus] ?? 0) }));
    } else if (report === "approvals") {
      const source = await this.approvals(userId, input);
      rows = source.byManager.map((row) => ({ manager: row.actor.username, approved: row.approved, returned: row.returned, rejected: row.rejected, averageApprovalCycleMinutes: row.averageApprovalCycleMinutes ?? "N/A" }));
    } else {
      const source = await this.warehouse(userId, input);
      rows = source.items.map((row) => ({ sku: row.sku, itemName: row.nameAr, totalBaseQuantity: row.totalBaseQuantity }));
    }
    if (rows.length > 5_000) throw new BadRequestException("The export exceeds the 5,000-row operational limit.");
    return {
      report,
      rows: rows.map((row) => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, typeof value === "string" && csvDangerous.test(value) ? `'${value}` : value]),
      )),
    };
  }
}
