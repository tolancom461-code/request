import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Pagination, Paper, Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import TaskAltOutlinedIcon from "@mui/icons-material/TaskAltOutlined";
import { BusyButton, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard } from "./foundation";

type ApiError = Error & { status?: number };
type Branch = { id: string; code: string; nameAr: string; nameEn: string };
type QueueEntry = { id: string; requestNumber: string; branch: Branch; creator: { id: string; username: string }; status: string; submittedAt: string | null; approvedAt: string | null; warehouseAvailableAt: string | null; updatedAt: string; activeLineCount: number; rowVersion: number };
type Queue = { page: number; pageSize: number; total: number; data: QueueEntry[] };
type WarehouseLine = { id: string; itemId: string; item: { nameAr: string; nameEn: string; nameUr: string }; sku: string; unit: { code: string; nameAr: string; nameEn: string }; requestedQuantity: string; conversionFactorSnapshot: string; baseQuantitySnapshot: string; supplierSnapshot: { id: string; code: string; name: string }; lineStatus: "active" | "excluded"; exclusion: { removalReason: string | null } | null };
type WarehouseDetail = { id: string; requestNumber: string; branch: Branch; creator: { id: string; username: string; email: string }; status: string; rowVersion: number; submittedAt: string | null; approvedAt: string | null; warehouseAvailableAt: string | null; items: WarehouseLine[]; statusHistory: Array<{ id: string; actorType: string; actor: { id: string; username: string } | null; fromStatus: string | null; toStatus: string; reason: string | null; occurredAt: string }> };
type GroupBy = "request" | "branch" | "supplier" | "item";
type Group = { key: string; label: Record<string, string>; requestCount: number; lineCount: number; totalBaseQuantity: string; lines: Array<{ requestId: string; requestNumber: string; requestStatus: string; branch: Branch; item: { id: string; sku: string; nameAr: string; nameEn: string; nameUr: string }; supplierSnapshot: { id: string; code: string; name: string }; unit: { id: string; code: string; nameAr: string; nameEn: string }; requestedQuantity: string; baseQuantitySnapshot: string }> };
type Intent = { action: "start-preparation" | "mark-ready" | "dispatch" | "complete"; label: string; icon: "start" | "ready" | "dispatch" | "complete" } | null;
const statuses = ["sent_to_warehouse", "preparing", "ready", "dispatched", "completed"] as const;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as { message?: string } | T | null;
  if (!response.ok) { const error = new Error(typeof payload === "object" && payload && "message" in payload ? String(payload.message) : `HTTP ${response.status}`) as ApiError; error.status = response.status; throw error; }
  return payload as T;
}
async function csrf() { return api<{ csrfToken: string }>("/api/v1/auth/csrf", { cache: "no-store" }); }
async function mutate<T>(path: string, body: unknown) { const token = await csrf(); return api<T>(path, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": token.csrfToken }, body: JSON.stringify(body) }); }
const localized = (value: { nameAr: string; nameEn: string; nameUr?: string | null }, language: string) => language.startsWith("ur") ? value.nameUr || value.nameEn || value.nameAr : language.startsWith("en") ? value.nameEn || value.nameAr : value.nameAr;
const time = (value: string | null, language: string) => value ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const caughtMessage = (caught: unknown, fallback: string) => caught instanceof Error ? caught.message : fallback;

function stateChip(status: string, label: string) {
  const color = status === "sent_to_warehouse" ? "info" : status === "preparing" ? "warning" : status === "ready" ? "success" : status === "dispatched" ? "primary" : "default";
  return <Chip color={color} label={label} size="small" />;
}

export function WarehouseOperationsPage({ online, path, onNavigate }: { online: boolean; path: string; onNavigate: (path: string) => void }) {
  const { i18n, t } = useTranslation();
  const requestId = useMemo(() => /^#\/warehouse\/requests\/([0-9a-f-]{36})$/i.exec(path)?.[1] ?? null, [path]);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [detail, setDetail] = useState<WarehouseDetail | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [groupBy, setGroupBy] = useState<GroupBy>("request");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [intent, setIntent] = useState<Intent>(null);

  const params = useCallback((includeGroup = false) => {
    const value = new URLSearchParams({ page: String(page), pageSize: "20", sort: "warehouseAvailableAt", direction: "asc" });
    if (search.trim()) value.set("search", search.trim());
    if (status) value.set("status", status);
    if (includeGroup) value.set("groupBy", groupBy);
    return value;
  }, [groupBy, page, search, status]);

  const loadQueue = useCallback(async () => {
    if (!online || requestId) return;
    setLoading(true); setError(null);
    try {
      const [queueResult, groupResult] = await Promise.all([
        api<Queue>(`/api/v1/warehouse/requests?${params()}`),
        api<{ data: Group[] }>(`/api/v1/warehouse/requests/groups?${params(true)}`),
      ]);
      setQueue(queueResult); setGroups(groupResult.data);
    } catch (caught) { setError(caughtMessage(caught, t("warehouseLoadFailed"))); } finally { setLoading(false); }
  }, [online, params, requestId, t]);

  const loadDetail = useCallback(async () => {
    if (!online || !requestId) return;
    setLoading(true); setError(null); setConflict(false);
    try { setDetail(await api<WarehouseDetail>(`/api/v1/warehouse/requests/${requestId}`)); }
    catch (caught) { setError(caughtMessage(caught, t("warehouseLoadFailed"))); } finally { setLoading(false); }
  }, [online, requestId, t]);

  useEffect(() => { if (requestId) void loadDetail(); else void loadQueue(); }, [loadDetail, loadQueue, requestId]);
  useEffect(() => { if (!requestId) { setDetail(null); setConflict(false); } }, [requestId]);

  const handleError = (caught: unknown, fallback: string) => { const apiError = caught as ApiError; if (apiError.status === 409) setConflict(true); setError(caughtMessage(caught, fallback)); };
  const currentIntent = (current: string): Intent => current === "sent_to_warehouse" ? { action: "start-preparation", label: t("warehouseStartPreparation"), icon: "start" } : current === "preparing" ? { action: "mark-ready", label: t("warehouseMarkReady"), icon: "ready" } : current === "ready" ? { action: "dispatch", label: t("warehouseDispatch"), icon: "dispatch" } : current === "dispatched" ? { action: "complete", label: t("warehouseComplete"), icon: "complete" } : null;
  const confirmTransition = async () => {
    if (!detail || !intent || !online) return;
    setBusy(true);
    try { const updated = await mutate<WarehouseDetail>(`/api/v1/warehouse/requests/${detail.id}/${intent.action}`, { expectedRowVersion: detail.rowVersion }); setDetail(updated); setIntent(null); }
    catch (caught) { handleError(caught, t("warehouseTransitionFailed")); } finally { setBusy(false); }
  };
  const actionIcon = (kind: NonNullable<Intent>["icon"]) => kind === "start" ? <PlayArrowOutlinedIcon /> : kind === "ready" ? <CheckCircleOutlineOutlinedIcon /> : kind === "dispatch" ? <LocalShippingOutlinedIcon /> : <TaskAltOutlinedIcon />;

  if (!online) return <SectionCard><ErrorState message={t("warehouseOffline")} title={t("warehouseQueue")} /></SectionCard>;
  if (!requestId) {
    const pages = Math.max(1, Math.ceil((queue?.total ?? 0) / 20));
    return <Box>
      <PageHeader eyebrow="PHASE 7 · WAREHOUSE OPERATIONS" title={t("warehouseQueue")} description={t("warehouseQueueDescription")} actions={<Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}><TextField aria-label={t("warehouseSearch")} label={t("warehouseSearch")} onChange={(event) => { setSearch(event.target.value); setPage(1); }} size="small" value={search} /><FormControl size="small" sx={{ minWidth: 170 }}><InputLabel id="warehouse-status-filter">{t("status")}</InputLabel><Select label={t("status")} labelId="warehouse-status-filter" onChange={(event) => { setStatus(event.target.value); setPage(1); }} value={status}><MenuItem value="">{t("warehouseOpenWork")}</MenuItem>{statuses.map((value) => <MenuItem key={value} value={value}>{t(value)}</MenuItem>)}</Select></FormControl><FormControl size="small" sx={{ minWidth: 155 }}><InputLabel id="warehouse-group-filter">{t("warehouseGroupBy")}</InputLabel><Select label={t("warehouseGroupBy")} labelId="warehouse-group-filter" onChange={(event) => setGroupBy(event.target.value as GroupBy)} value={groupBy}>{(["request", "branch", "supplier", "item"] as GroupBy[]).map((value) => <MenuItem key={value} value={value}>{t(`warehouseGroup${value[0].toUpperCase()}${value.slice(1)}`)}</MenuItem>)}</Select></FormControl></Box>} />
      {error && <Alert onClose={() => setError(null)} severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && !queue ? <LoadingState title={t("loadingTitle")} message={t("warehouseLoading")} /> : !queue?.data.length ? <SectionCard><EmptyState title={t("warehouseEmpty")} message={t("warehouseEmptyDescription")} /></SectionCard> : <><SectionCard title={t("warehouseOpenRequests")}><TableContainer component={Paper} variant="outlined"><Table aria-label={t("warehouseQueue")} size="small"><TableHead><TableRow><TableCell>{t("requestNumber")}</TableCell><TableCell>{t("branch")}</TableCell><TableCell>{t("warehouseAvailableAt")}</TableCell><TableCell>{t("activeLines")}</TableCell><TableCell>{t("status")}</TableCell><TableCell align="right">{t("actions")}</TableCell></TableRow></TableHead><TableBody>{queue.data.map((entry) => <TableRow hover key={entry.id}><TableCell>{entry.requestNumber}</TableCell><TableCell>{entry.branch.code} · {localized({ nameAr: entry.branch.nameAr, nameEn: entry.branch.nameEn }, i18n.language)}</TableCell><TableCell>{time(entry.warehouseAvailableAt, i18n.language)}</TableCell><TableCell>{entry.activeLineCount}</TableCell><TableCell>{stateChip(entry.status, t(entry.status))}</TableCell><TableCell align="right"><Button onClick={() => onNavigate(`#/warehouse/requests/${entry.id}`)} size="small" startIcon={<WarehouseOutlinedIcon />}>{t("warehouseOpenDetail")}</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer><Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}><Pagination count={pages} onChange={(_, value) => setPage(value)} page={page} /></Box></SectionCard><Box sx={{ mt: 2 }}><SectionCard title={`${t("warehouseGroupBy")} · ${t(`warehouseGroup${groupBy[0].toUpperCase()}${groupBy.slice(1)}`)}`}><Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" } }}>{groups?.map((group) => <Paper key={group.key} variant="outlined" sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 800 }}>{group.label.requestNumber ?? group.label.code ?? group.label.sku}</Typography><Typography color="text.secondary" variant="body2">{group.label.nameAr ?? group.label.name ?? group.label.nameEn ?? group.label.branchCode ?? ""}</Typography><Typography sx={{ mt: 1 }} variant="body2">{t("warehouseGroupRequests", { count: group.requestCount })} · {t("warehouseGroupLines", { count: group.lineCount })}</Typography><Typography color="primary.main" sx={{ fontWeight: 800 }} variant="body2">{t("warehouseBaseTotal")}: {group.totalBaseQuantity}</Typography></Paper>)}</Box></SectionCard></Box></>}
    </Box>;
  }

  if (loading && !detail) return <LoadingState title={t("loadingTitle")} message={t("warehouseLoading")} />;
  if (!detail) return <SectionCard><ErrorState action={<Button onClick={() => void loadDetail()} variant="outlined">{t("retry")}</Button>} message={error ?? t("warehouseLoadFailed")} title={t("warehouseRequestDetail")} /></SectionCard>;
  const transition = currentIntent(detail.status);
  const activeLines = detail.items.filter((line) => line.lineStatus === "active");
  return <Box>
    <PageHeader eyebrow="PHASE 7 · WAREHOUSE OPERATIONS" title={`${t("warehouseRequestDetail")} · ${detail.requestNumber}`} description={`${detail.branch.code} · ${time(detail.warehouseAvailableAt, i18n.language)}`} actions={<Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}><Button onClick={() => onNavigate("#/warehouse/requests")} variant="text">{t("warehouseBackToQueue")}</Button>{transition && <BusyButton busy={busy} disabled={!activeLines.length} onClick={() => setIntent(transition)} startIcon={actionIcon(transition.icon)} variant="contained">{transition.label}</BusyButton>}</Box>} />
    {error && <Alert onClose={() => setError(null)} severity={conflict ? "warning" : "error"} sx={{ mb: 2 }}>{conflict ? t("warehouseStale") : error}{conflict && <Button onClick={() => void loadDetail()} size="small">{t("refresh")}</Button>}</Alert>}
    {detail.status === "completed" && <Alert severity="info" sx={{ mb: 2 }}>{t("warehouseCompletedReadOnly")}</Alert>}
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1.2fr .8fr" } }}><SectionCard title={t("warehouseLines")}><TableContainer component={Paper} variant="outlined"><Table size="small"><TableHead><TableRow><TableCell>{t("item")}</TableCell><TableCell>{t("supplier")}</TableCell><TableCell>{t("unit")}</TableCell><TableCell>{t("quantity")}</TableCell><TableCell>{t("warehouseBaseTotal")}</TableCell><TableCell>{t("status")}</TableCell></TableRow></TableHead><TableBody>{detail.items.map((line) => <TableRow key={line.id}><TableCell>{localized(line.item, i18n.language)}<Typography color="text.secondary" sx={{ display: "block" }} variant="caption">{line.sku}</Typography></TableCell><TableCell>{line.supplierSnapshot.code}<Typography color="text.secondary" sx={{ display: "block" }} variant="caption">{line.supplierSnapshot.name}</Typography></TableCell><TableCell>{localized({ nameAr: line.unit.nameAr, nameEn: line.unit.nameEn }, i18n.language)}</TableCell><TableCell>{line.requestedQuantity}</TableCell><TableCell>{line.baseQuantitySnapshot}</TableCell><TableCell>{line.lineStatus === "active" ? <Chip color="success" label={t("active")} size="small" /> : <><Chip label={t("managerExcluded")} size="small" />{line.exclusion?.removalReason && <Typography color="text.secondary" sx={{ display: "block", maxWidth: 160 }} variant="caption">{line.exclusion.removalReason}</Typography>}</>}</TableCell></TableRow>)}</TableBody></Table></TableContainer></SectionCard><Box sx={{ display: "grid", gap: 2 }}><SectionCard title={t("warehouseRequestContext")}><Typography component="p"><strong>{t("branch")}:</strong> {detail.branch.code} · {localized({ nameAr: detail.branch.nameAr, nameEn: detail.branch.nameEn }, i18n.language)}</Typography><Typography component="p" sx={{ mt: 1 }}><strong>{t("submittedAt")}:</strong> {time(detail.submittedAt, i18n.language)}</Typography><Typography component="p" sx={{ mt: 1 }}><strong>{t("warehouseAvailableAt")}:</strong> {time(detail.warehouseAvailableAt, i18n.language)}</Typography><Typography component="p" sx={{ mt: 1 }}><strong>{t("managerRowVersion")}:</strong> {detail.rowVersion}</Typography><Box sx={{ mt: 1 }}>{stateChip(detail.status, t(detail.status))}</Box></SectionCard><SectionCard title={t("warehouseHistory")}><Box sx={{ display: "grid", gap: 1 }}>{detail.statusHistory.map((entry) => <Paper key={entry.id} variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }} variant="body2">{entry.fromStatus ? t(entry.fromStatus) : "—"} → {t(entry.toStatus)}</Typography><Typography color="text.secondary" variant="caption">{entry.actor?.username ?? t("managerSystemActor")} · {time(entry.occurredAt, i18n.language)}</Typography>{entry.reason && <Typography variant="body2" sx={{ mt: .5 }}>{entry.reason}</Typography>}</Paper>)}</Box></SectionCard></Box></Box>
    {intent && <Dialog fullWidth maxWidth="xs" onClose={() => setIntent(null)} open><DialogTitle>{intent.label}</DialogTitle><DialogContent><Typography>{t("warehouseTransitionNotice", { action: intent.label })}</Typography></DialogContent><DialogActions><Button onClick={() => setIntent(null)}>{t("cancel")}</Button><BusyButton busy={busy} onClick={() => void confirmTransition()} startIcon={actionIcon(intent.icon)} variant="contained">{t("confirm")}</BusyButton></DialogActions></Dialog>}
  </Box>;
}
