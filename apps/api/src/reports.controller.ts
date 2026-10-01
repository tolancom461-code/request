import { Controller, Get, Inject, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { RequestStatus } from "@prisma/client";
import { z } from "zod";
import { Permissions, PermissionsGuard } from "./security.js";
import type { SessionRecord } from "./session.service.js";
import { ReportsService, type ExportReport, type ReportInput } from "./reports.service.js";

type RequestWithSession = FastifyRequest & { restaurantSession?: SessionRecord };
const id = z.string().uuid();
const inputSchema = z.object({
  from: z.string().datetime().optional(), to: z.string().datetime().optional(), branchId: id.optional(),
  status: z.union([z.string(), z.array(z.string())]).optional(), search: z.string().trim().max(160).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(24),
  sort: z.enum(["submittedAt", "requestNumber", "status", "branch", "baseQuantity"]).default("submittedAt"), direction: z.enum(["asc", "desc"]).default("desc"),
});
const exportType = z.enum(["requests", "branches", "items", "suppliers", "status-lifecycle", "approvals", "warehouse"]);

const reportInput = (raw: unknown): ReportInput => {
  const parsed = inputSchema.parse(raw);
  const now = new Date();
  const from = parsed.from ? new Date(parsed.from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = parsed.to ? new Date(parsed.to) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("Invalid report dates.");
  const rawStatuses = parsed.status ? (Array.isArray(parsed.status) ? parsed.status : [parsed.status]).flatMap((value) => value.split(",")).filter(Boolean) : undefined;
  return { ...parsed, from, to, statuses: rawStatuses?.map((status) => z.nativeEnum(RequestStatus).parse(status.trim())) };
};

const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

@Controller("reports")
@UseGuards(PermissionsGuard)
@Permissions("reports.view")
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}
  private user(request: RequestWithSession) { return request.restaurantSession!.userId; }

  @Get("filters") filters(@Req() request: RequestWithSession) { return this.reports.filterOptions(this.user(request)); }
  @Get("dashboard") dashboard(@Req() request: RequestWithSession, @Query() query: unknown) { return this.reports.dashboard(this.user(request), reportInput(query)); }
  @Get("requests") requests(@Req() request: RequestWithSession, @Query() query: unknown) { return this.reports.requests(this.user(request), reportInput(query)); }
  @Get("branches") branches(@Req() request: RequestWithSession, @Query() query: unknown) { return this.reports.branches(this.user(request), reportInput(query)); }
  @Get("items") items(@Req() request: RequestWithSession, @Query() query: unknown) { return this.reports.items(this.user(request), reportInput(query)); }
  @Get("suppliers") suppliers(@Req() request: RequestWithSession, @Query() query: unknown) { return this.reports.suppliers(this.user(request), reportInput(query)); }
  @Get("status-lifecycle") statusLifecycle(@Req() request: RequestWithSession, @Query() query: unknown) { return this.reports.statusLifecycle(this.user(request), reportInput(query)); }
  @Get("approvals") approvals(@Req() request: RequestWithSession, @Query() query: unknown) { return this.reports.approvals(this.user(request), reportInput(query)); }
  @Get("warehouse") warehouse(@Req() request: RequestWithSession, @Query() query: unknown) { return this.reports.warehouse(this.user(request), reportInput(query)); }

  @Get("export")
  @Permissions("reports.view", "reports.export")
  async export(@Req() request: RequestWithSession, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const raw = query as Record<string, unknown>;
    const report = exportType.parse(raw.report) as ExportReport;
    const result = await this.reports.exportRows(this.user(request), report, reportInput(query));
    const columns = result.rows.length ? Object.keys(result.rows[0] ?? {}) : [];
    const csv = `\uFEFF${[columns.map(quote).join(","), ...result.rows.map((row) => columns.map((column) => quote(row[column])).join(","))].filter(Boolean).join("\r\n")}\r\n`;
    const from = String(raw.from ?? "last-30-days").replace(/[^A-Za-z0-9-]/g, "").slice(0, 20) || "last-30-days";
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="restaurant-reports-${report}-${from}.csv"`);
    return csv;
  }
}
