import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, FormControl, InputLabel, MenuItem,
  Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import { EmptyState, ErrorState, LoadingState, OfflineNotice, PageHeader, SectionCard } from "./foundation";

type Branch = { id: string; code: string; nameAr: string; nameEn: string };
type FilterOptions = { branches: Branch[]; statuses: string[] };
type Dashboard = { kpis: { submittedRequests: number; currentStatusCounts: Record<string, number>; totalActiveRequestedBaseQuantity: string; completionRate: number; returnRate: number; rejectionRate: number; averageApprovalCycleMinutes: number | null; averageWarehouseProcessingMinutes: number | null; averageEndToEndCompletionMinutes: number | null }; metricDefinitions: Record<string, string> };
type List = { data: Array<Record<string, unknown>>; total?: number };
type ReportResponse = Dashboard | List | Record<string, unknown>;
type TabKey = "dashboard" | "requests" | "branches" | "items" | "suppliers" | "status-lifecycle" | "approvals" | "warehouse";

const tabOrder: TabKey[] = ["dashboard", "requests", "branches", "items", "suppliers", "status-lifecycle", "approvals", "warehouse"];
const tabPath = (tab: TabKey) => tab === "dashboard" ? "#/reports" : `#/reports/${tab}`;
const asString = (value: unknown) => value === null || value === undefined ? "—" : String(value);
const isoDay = (value: string, end = false) => new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}`).toISOString();
const daysAgo = (days: number) => { const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString().slice(0, 10); };

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function labelFor(t: (key: string, options?: Record<string, unknown>) => string, key: string) { return t(`report.${key}`); }
function number(locale: string, value: unknown) { return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(value ?? 0)); }
function dateTime(locale: string, value: unknown) { return value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value))) : "—"; }

function MetricCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <Card variant="outlined" sx={{ minWidth: 0 }}><CardContent sx={{ p: 2.1, "&:last-child": { pb: 2.1 } }}><Typography color="text.secondary" variant="body2">{label}</Typography><Typography component="p" sx={{ color: "primary.dark", fontSize: "1.7rem", fontWeight: 800, mt: 0.6 }}>{value}</Typography>{note && <Typography color="text.secondary" variant="caption">{note}</Typography>}</CardContent></Card>;
}

export function ReportsDashboardPage({ online, path, canExport }: { online: boolean; path: string; canExport: boolean }) {
  const { i18n, t } = useTranslation();
  const locale = i18n.language.startsWith("ur") ? "ur-PK" : i18n.language.startsWith("en") ? "en-GB" : "ar-SA";
  const tab = (tabOrder.find((entry) => path === tabPath(entry)) ?? "dashboard") as TabKey;
  const [from, setFrom] = useState(() => daysAgo(30));
  const [to, setTo] = useState(() => daysAgo(0));
  const [branchId, setBranchId] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams({ from: isoDay(from), to: isoDay(to, true), page: "1", pageSize: "48", sort: "submittedAt", direction: "desc" });
    if (branchId) params.set("branchId", branchId);
    if (statuses.length) params.set("status", statuses.join(","));
    if (search.trim()) params.set("search", search.trim());
    return params;
  }, [from, to, branchId, statuses, search]);

  const load = useCallback(async () => {
    if (!online) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [nextOptions, nextData] = await Promise.all([
        getJson<FilterOptions>("/api/v1/reports/filters"),
        getJson<ReportResponse>(`/api/v1/reports/${tab}?${query.toString()}`),
      ]);
      setOptions(nextOptions); setData(nextData);
    } catch { setError("reportLoadFailed"); setData(null); }
    finally { setLoading(false); }
  }, [online, query, tab]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  const updateTab = (_: unknown, next: TabKey) => { window.location.hash = tabPath(next); };
  const exportCurrent = () => {
    if (!canExport || !online || tab === "dashboard") return;
    const params = new URLSearchParams(query); params.set("report", tab);
    window.location.assign(`/api/v1/reports/export?${params.toString()}`);
  };
  const dashboard = tab === "dashboard" ? data as Dashboard | null : null;
  const list = tab === "dashboard" ? null : data as ReportResponse | null;
  const reportRows = list && typeof list === "object" && "data" in list && Array.isArray((list as List).data)
    ? (list as List).data
    : list ? [list as Record<string, unknown>] : [];
  const statusRows = dashboard ? Object.entries(dashboard.kpis.currentStatusCounts) : [];

  return <Box>
    <PageHeader
      eyebrow="PHASE 9 · REPORTS"
      title={t("report.title")}
      description={t("report.description")}
      actions={<Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}><Button disabled={loading || !online} onClick={() => setRefreshKey((value) => value + 1)} startIcon={<RefreshOutlinedIcon />} variant="outlined">{t("retry")}</Button>{tab !== "dashboard" && <Button disabled={!canExport || !online} onClick={exportCurrent} startIcon={<DownloadOutlinedIcon />} variant="contained">{t("report.exportCsv")}</Button>}</Box>}
    />
    {!online && <OfflineNotice message={t("report.offline")} />}
    <Box sx={{ mt: 2 }}><SectionCard title={t("report.filters")}>
      <Box component="form" onSubmit={(event) => { event.preventDefault(); setRefreshKey((value) => value + 1); }} sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(5, minmax(0, 1fr))" } }}>
        <TextField label={t("report.from")} onChange={(event) => setFrom(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} type="date" value={from} />
        <TextField label={t("report.to")} onChange={(event) => setTo(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} type="date" value={to} />
        <FormControl><InputLabel id="report-branch-label">{t("branch")}</InputLabel><Select label={t("branch")} labelId="report-branch-label" onChange={(event) => setBranchId(String(event.target.value))} value={branchId}><MenuItem value="">{t("report.allAuthorizedBranches")}</MenuItem>{options?.branches.map((branch) => <MenuItem key={branch.id} value={branch.id}>{branch.code} · {i18n.language.startsWith("en") ? branch.nameEn : branch.nameAr}</MenuItem>)}</Select></FormControl>
        <FormControl><InputLabel id="report-status-label">{t("status")}</InputLabel><Select label={t("status")} labelId="report-status-label" multiple onChange={(event) => setStatuses((event.target.value as string[]))} renderValue={(selected) => (selected as string[]).map((value) => t(value)).join("، ")} value={statuses}>{options?.statuses.map((status) => <MenuItem key={status} value={status}>{t(status)}</MenuItem>)}</Select></FormControl>
        <TextField label={t("report.search")} onChange={(event) => setSearch(event.target.value)} value={search} />
        <Box sx={{ alignItems: "center", display: "flex", gap: 1, gridColumn: { lg: "span 5" } }}><Button disabled={!online} type="submit" variant="contained">{t("apply")}</Button><Button onClick={() => { setFrom(daysAgo(30)); setTo(daysAgo(0)); setBranchId(""); setStatuses([]); setSearch(""); setRefreshKey((value) => value + 1); }} variant="text">{t("report.reset")}</Button><Typography color="text.secondary" variant="caption">{t("report.filterScopeNote")}</Typography></Box>
      </Box>
    </SectionCard></Box>
    <Box sx={{ mt: 2 }}><SectionCard>
      <Tabs aria-label={t("report.tabs")} onChange={updateTab} scrollButtons="auto" value={tab} variant="scrollable">{tabOrder.map((entry) => <Tab key={entry} label={labelFor(t, entry)} value={entry} />)}</Tabs>
      <Divider sx={{ mt: 1 }} />
      {loading ? <Box sx={{ p: 3 }}><LoadingState message={t("report.loading")} title={labelFor(t, tab)} /></Box> : error ? <Box sx={{ p: 3 }}><ErrorState action={<Button onClick={() => setRefreshKey((value) => value + 1)} variant="outlined">{t("retry")}</Button>} message={t(error)} title={labelFor(t, tab)} /></Box> : !online ? <Box sx={{ p: 3 }}><Alert severity="warning">{t("report.offline")}</Alert></Box> : dashboard ? <DashboardView dashboard={dashboard} locale={locale} t={t} statusRows={statusRows} /> : <ReportTable tab={tab} data={reportRows} locale={locale} t={t} />}
    </SectionCard></Box>
  </Box>;
}

function DashboardView({ dashboard, locale, t, statusRows }: { dashboard: Dashboard; locale: string; t: (key: string, options?: Record<string, unknown>) => string; statusRows: [string, number][] }) {
  const kpis = dashboard.kpis;
  return <Box sx={{ pt: 2 }}>
    <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" } }}>
      <MetricCard label={t("report.submittedRequests")} value={number(locale, kpis.submittedRequests)} />
      <MetricCard label={t("report.activeBaseQuantity")} value={number(locale, kpis.totalActiveRequestedBaseQuantity)} note={t("report.workflowQuantity")} />
      <MetricCard label={t("report.completionRate")} value={`${number(locale, kpis.completionRate)}%`} />
      <MetricCard label={t("report.returnRate")} value={`${number(locale, kpis.returnRate)}%`} />
      <MetricCard label={t("report.rejectionRate")} value={`${number(locale, kpis.rejectionRate)}%`} />
      <MetricCard label={t("report.avgApproval")} value={kpis.averageApprovalCycleMinutes === null ? "N/A" : number(locale, kpis.averageApprovalCycleMinutes)} note={t("report.minutes")} />
      <MetricCard label={t("report.avgWarehouse")} value={kpis.averageWarehouseProcessingMinutes === null ? "N/A" : number(locale, kpis.averageWarehouseProcessingMinutes)} note={t("report.minutes")} />
      <MetricCard label={t("report.avgEndToEnd")} value={kpis.averageEndToEndCompletionMinutes === null ? "N/A" : number(locale, kpis.averageEndToEndCompletionMinutes)} note={t("report.minutes")} />
    </Box>
    <Box sx={{ mt: 2 }}><Typography component="h2" variant="h6">{t("report.currentStatus")}</Typography><TableContainer sx={{ mt: 1 }}><Table size="small"><TableHead><TableRow><TableCell>{t("status")}</TableCell><TableCell align="right">{t("report.count")}</TableCell></TableRow></TableHead><TableBody>{statusRows.map(([status, count]) => <TableRow key={status}><TableCell><Chip label={t(status)} size="small" /></TableCell><TableCell align="right">{number(locale, count)}</TableCell></TableRow>)}</TableBody></Table></TableContainer></Box>
    <Alert severity="info" sx={{ mt: 2 }}>{t("report.metricNote")}</Alert>
  </Box>;
}

function ReportTable({ tab, data, locale, t }: { tab: TabKey; data: Array<Record<string, unknown>>; locale: string; t: (key: string, options?: Record<string, unknown>) => string }) {
  if (!data.length) return <Box sx={{ p: 3 }}><EmptyState message={t("report.emptyDescription")} title={t("report.empty")} /></Box>;
  const columns: Record<Exclude<TabKey, "dashboard">, string[]> = {
    requests: ["requestNumber", "branch", "creator", "currentStatus", "submittedAt", "approvedAt", "warehouseAvailableAt", "completedAt", "activeLineCount", "excludedLineCount", "activeBaseQuantity"],
    branches: ["branch", "requestCount", "completedCount", "pendingCount", "returnedCount", "rejectedCount", "completionRate", "totalActiveBaseQuantity", "averageEndToEndCompletionMinutes"],
    items: ["item", "requestCount", "activeLineCount", "requestedQuantityByUnit", "totalBaseQuantity", "branches"],
    suppliers: ["supplierSnapshot", "associatedRequestCount", "activeLineCount", "totalBaseQuantity", "currentStatusDistribution", "branches"],
    "status-lifecycle": ["currentStatusDistribution", "transitionEventCounts", "approvalCycleEventCount", "averageApprovalCycleMinutes", "averageWarehouseProcessingMinutes", "funnel"],
    approvals: ["decisionCounts", "byManager", "byBranch"],
    warehouse: ["counts", "averageWarehouseCycleMinutes", "branches", "suppliers", "items"],
  };
  const rows = tab === "requests" || tab === "branches" || tab === "items" || tab === "suppliers" ? data : [Array.isArray(data) ? (data[0] ?? {}) : data];
  const headings = columns[tab as Exclude<TabKey, "dashboard">];
  const render = (key: string, value: unknown) => {
    if (key === "branch" && value && typeof value === "object") return `${(value as Branch).code} · ${(value as Branch).nameAr}`;
    if (key === "item" && value && typeof value === "object") return `${(value as { sku: string }).sku} · ${(value as { nameAr: string }).nameAr}`;
    if (key === "supplierSnapshot" && value && typeof value === "object") return `${(value as { code: string }).code} · ${(value as { name: string }).name}`;
    if (key === "creator" && value && typeof value === "object") return (value as { username?: string }).username ?? "—";
    if (key === "requestedQuantityByUnit" && Array.isArray(value)) return value.map((entry) => `${asString((entry as { unitCode?: unknown }).unitCode)} × ${asString((entry as { quantity?: unknown }).quantity)}`).join(" · ");
    if (key === "branches" && Array.isArray(value)) return value.map((entry) => {
      const row = entry as { code?: unknown; totalBaseQuantity?: unknown; requestCount?: unknown };
      const detail = row.totalBaseQuantity ?? row.requestCount;
      return `${asString(row.code)} · ${asString(detail)}`;
    }).join(" · ");
    if (key === "suppliers" && Array.isArray(value)) return value.map((entry) => `${asString((entry as { snapshot?: unknown }).snapshot)} · ${asString((entry as { totalBaseQuantity?: unknown }).totalBaseQuantity)}`).join(" · ");
    if (key === "items" && Array.isArray(value)) return value.map((entry) => `${asString((entry as { sku?: unknown }).sku)} · ${asString((entry as { totalBaseQuantity?: unknown }).totalBaseQuantity)}`).join(" · ");
    if (key === "byManager" && Array.isArray(value)) return value.map((entry) => {
      const row = entry as { actor?: { username?: string }; approved?: unknown; returned?: unknown; rejected?: unknown; averageApprovalCycleMinutes?: unknown };
      return `${row.actor?.username ?? t("report.unavailable")}: ${t("approved")} ${asString(row.approved)} · ${t("returned")} ${asString(row.returned)} · ${t("rejected")} ${asString(row.rejected)} · ${t("report.column.averageApprovalCycleMinutes")} ${asString(row.averageApprovalCycleMinutes)}`;
    }).join(" · ");
    if (key === "byBranch" && Array.isArray(value)) return value.map((entry) => {
      const row = entry as { branch?: { code?: string }; approved?: unknown; returned?: unknown; rejected?: unknown };
      return `${row.branch?.code ?? t("report.unavailable")}: ${t("approved")} ${asString(row.approved)} · ${t("returned")} ${asString(row.returned)} · ${t("rejected")} ${asString(row.rejected)}`;
    }).join(" · ");
    if (["currentStatusDistribution", "transitionEventCounts", "decisionCounts", "counts", "funnel"].includes(key) && value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([label, count]) => {
      const metricLabel = key === "funnel" ? t(`report.funnel.${label}`, { defaultValue: t(label) }) : key === "decisionCounts" ? t(`report.decision.${label}`, { defaultValue: t(label) }) : key === "counts" ? t(`report.warehouseMetrics.${label}`, { defaultValue: t(label) }) : t(label);
      return `${metricLabel}: ${asString(count)}`;
    }).join(" · ");
    if (key.endsWith("At")) return dateTime(locale, value);
    if (typeof value === "object" && value !== null) return <Typography color="text.secondary" variant="body2">{t("report.unavailable")}</Typography>;
    if (key === "currentStatus") return <Chip label={t(asString(value))} size="small" />;
    return asString(value);
  };
  return <TableContainer sx={{ maxHeight: 620, pt: 2 }}><Table aria-label={t(`report.${tab}`)} size="small" stickyHeader><TableHead><TableRow>{headings.map((heading) => <TableCell key={heading}>{t(`report.column.${heading}`, { defaultValue: heading })}</TableCell>)}</TableRow></TableHead><TableBody>{rows.map((row, index) => <TableRow hover key={String(row.id ?? row.requestNumber ?? index)}>{headings.map((heading) => <TableCell key={heading} sx={{ maxWidth: 280, verticalAlign: "top" }}>{render(heading, row[heading])}</TableCell>)}</TableRow>)}</TableBody></Table></TableContainer>;
}
