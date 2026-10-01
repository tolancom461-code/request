import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Pagination, Paper, Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import KeyboardReturnOutlinedIcon from "@mui/icons-material/KeyboardReturnOutlined";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import { BusyButton, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard } from "./foundation";

type ApiError = Error & { status?: number };
type Branch = { id: string; code: string; nameAr: string; nameEn: string };
type Unit = { id: string; code: string; nameAr: string; nameEn: string; isBaseUnit: boolean };
type RequestLine = { id: string; branchItemId: string; itemId: string; item: { nameAr: string; nameEn: string; nameUr: string }; sku: string; itemUnitId: string; unit: { code: string; nameAr: string; nameEn: string }; requestedQuantity: string; conversionFactorSnapshot: string; baseQuantitySnapshot: string; supplierSnapshot: { id: string; code: string; name: string }; lineStatus: "active" | "excluded"; exclusion: { removedByUserId: string | null; removedAt: string | null; removalReason: string | null } | null };
type ReviewDetail = { id: string; requestNumber: string; branch: Branch; creator: { id: string; username: string; email: string }; status: string; rowVersion: number; submittedAt: string | null; approvedAt: string | null; warehouseAvailableAt: string | null; items: RequestLine[]; approvals: Array<{ id: string; decision: string; comment: string | null; decidedAt: string; actor: { id: string; username: string } }>; statusHistory: Array<{ id: string; actorType: string; actor: { id: string; username: string } | null; fromStatus: string | null; toStatus: string; reason: string | null; occurredAt: string }> };
type Inbox = { page: number; pageSize: number; total: number; data: Array<{ id: string; requestNumber: string; branch: Branch; creator: { id: string; username: string }; status: string; submittedAt: string | null; activeLineCount: number; rowVersion: number }> };
type ReasonIntent = { kind: "exclude"; line: RequestLine } | { kind: "return" | "reject" } | null;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const payload = await response.json().catch(() => null) as { message?: string } | T | null;
  if (!response.ok) { const error = new Error(typeof payload === "object" && payload && "message" in payload ? String(payload.message) : `HTTP ${response.status}`) as ApiError; error.status = response.status; throw error; }
  return payload as T;
}
async function csrf() { return api<{ csrfToken: string }>("/api/v1/auth/csrf", { cache: "no-store" }); }
async function mutate<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> { const token = await csrf(); return api<T>(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": token.csrfToken }, body: JSON.stringify(body) }); }
const localized = (value: { nameAr: string; nameEn: string; nameUr?: string | null }, language: string) => language.startsWith("ur") ? value.nameUr || value.nameEn || value.nameAr : language.startsWith("en") ? value.nameEn || value.nameAr : value.nameAr;
const time = (value: string | null, language: string) => value ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const caughtMessage = (caught: unknown, fallback: string) => caught instanceof Error ? caught.message : fallback;

export function ManagerApprovalPage({ online, path, onNavigate }: { online: boolean; path: string; onNavigate: (path: string) => void }) {
  const { i18n, t } = useTranslation();
  const reviewId = useMemo(() => /^#\/manager\/requisitions\/([0-9a-f-]{36})\/review$/i.exec(path)?.[1] ?? null, [path]);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [editing, setEditing] = useState<RequestLine | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [quantity, setQuantity] = useState("1");
  const [unitId, setUnitId] = useState("");
  const [reasonIntent, setReasonIntent] = useState<ReasonIntent>(null);
  const [reason, setReason] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);

  const loadInbox = useCallback(async () => {
    if (!online || reviewId) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20", sort: "submittedAt", direction: "desc" });
      if (search.trim()) params.set("search", search.trim());
      setInbox(await api<Inbox>(`/api/v1/manager/requests?${params}`));
    } catch (caught) { setError(caughtMessage(caught, t("managerLoadFailed"))); } finally { setLoading(false); }
  }, [online, page, reviewId, search, t]);

  const loadDetail = useCallback(async () => {
    if (!online || !reviewId) return;
    setLoading(true); setError(null); setConflict(false);
    try { setDetail(await api<ReviewDetail>(`/api/v1/manager/requests/${reviewId}`)); }
    catch (caught) { setError(caughtMessage(caught, t("managerLoadFailed"))); } finally { setLoading(false); }
  }, [online, reviewId, t]);

  useEffect(() => { if (reviewId) void loadDetail(); else void loadInbox(); }, [loadDetail, loadInbox, reviewId]);
  useEffect(() => { if (!reviewId) { setDetail(null); setConflict(false); } }, [reviewId]);

  const handleError = (caught: unknown, fallback: string) => { const apiError = caught as ApiError; if (apiError.status === 409) setConflict(true); setError(caughtMessage(caught, fallback)); };
  const openEdit = async (line: RequestLine) => {
    if (!detail || !online) return;
    setBusy(true); setError(null);
    try { const available = await api<Unit[]>(`/api/v1/manager/requests/${detail.id}/items/${line.id}/units`); setUnits(available); setUnitId(line.itemUnitId); setQuantity(line.requestedQuantity); setEditing(line); }
    catch (caught) { handleError(caught, t("managerLoadFailed")); } finally { setBusy(false); }
  };
  const saveLine = async () => {
    if (!detail || !editing || !online) return;
    setBusy(true);
    try { setDetail(await mutate<ReviewDetail>(`/api/v1/manager/requests/${detail.id}/items/${editing.id}`, "PATCH", { itemUnitId: unitId, requestedQuantity: quantity, expectedRowVersion: detail.rowVersion })); setEditing(null); }
    catch (caught) { handleError(caught, t("managerSaveFailed")); } finally { setBusy(false); }
  };
  const confirmReason = async () => {
    if (!detail || !reasonIntent || !reason.trim() || !online) return;
    setBusy(true);
    try {
      const result = reasonIntent.kind === "exclude"
        ? await mutate<ReviewDetail>(`/api/v1/manager/requests/${detail.id}/items/${reasonIntent.line.id}/exclude`, "POST", { reason: reason.trim(), expectedRowVersion: detail.rowVersion })
        : await mutate<ReviewDetail>(`/api/v1/manager/requests/${detail.id}/${reasonIntent.kind}`, "POST", { reason: reason.trim(), expectedRowVersion: detail.rowVersion });
      setReasonIntent(null); setReason("");
      if (result.status === "returned" || result.status === "rejected") onNavigate("#/manager/requisitions"); else setDetail(result);
    } catch (caught) { handleError(caught, t("managerDecisionFailed")); } finally { setBusy(false); }
  };
  const approve = async () => {
    if (!detail || !online) return;
    setBusy(true);
    try { await mutate<ReviewDetail>(`/api/v1/manager/requests/${detail.id}/approve`, "POST", { expectedRowVersion: detail.rowVersion }); setApproveOpen(false); onNavigate("#/manager/requisitions"); }
    catch (caught) { handleError(caught, t("managerDecisionFailed")); } finally { setBusy(false); }
  };
  const beginReason = (intent: ReasonIntent) => { setReasonIntent(intent); setReason(""); };

  if (!online) return <SectionCard><ErrorState message={t("managerOffline")} title={t("managerInbox")} /></SectionCard>;
  if (!reviewId) {
    const pages = Math.max(1, Math.ceil((inbox?.total ?? 0) / 20));
    return <Box>
      <PageHeader eyebrow="PHASE 6 · MANAGER REVIEW" title={t("managerInbox")} description={t("managerInboxDescription")} actions={<TextField aria-label={t("managerSearch")} label={t("managerSearch")} onChange={(event) => { setSearch(event.target.value); setPage(1); }} size="small" value={search} />} />
      {error && <Alert onClose={() => setError(null)} severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && !inbox ? <LoadingState title={t("loadingTitle")} message={t("managerLoading")} /> : !inbox?.data.length ? <SectionCard><EmptyState title={t("managerEmpty")} message={t("managerEmptyDescription")} /></SectionCard> : <SectionCard title={t("managerPendingRequests")}><TableContainer component={Paper} variant="outlined"><Table aria-label={t("managerInbox")} size="small"><TableHead><TableRow><TableCell>{t("requestNumber")}</TableCell><TableCell>{t("branch")}</TableCell><TableCell>{t("creator")}</TableCell><TableCell>{t("submittedAt")}</TableCell><TableCell>{t("activeLines")}</TableCell><TableCell>{t("status")}</TableCell><TableCell align="right">{t("actions")}</TableCell></TableRow></TableHead><TableBody>{inbox.data.map((entry) => <TableRow key={entry.id} hover><TableCell>{entry.requestNumber}</TableCell><TableCell>{entry.branch.code} · {localized({ nameAr: entry.branch.nameAr, nameEn: entry.branch.nameEn }, i18n.language)}</TableCell><TableCell>{entry.creator.username}</TableCell><TableCell>{time(entry.submittedAt, i18n.language)}</TableCell><TableCell>{entry.activeLineCount}</TableCell><TableCell><Chip color="warning" label={t("pending_approval")} size="small" /></TableCell><TableCell align="right"><Button onClick={() => onNavigate(`#/manager/requisitions/${entry.id}/review`)} size="small" startIcon={<AssignmentTurnedInOutlinedIcon />}>{t("managerReview")}</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer><Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}><Pagination count={pages} onChange={(_, value) => setPage(value)} page={page} /></Box></SectionCard>}
    </Box>;
  }

  if (loading && !detail) return <LoadingState title={t("loadingTitle")} message={t("managerLoading")} />;
  if (!detail) return <SectionCard><ErrorState action={<Button onClick={() => void loadDetail()} variant="outlined">{t("retry")}</Button>} message={error ?? t("managerLoadFailed")} title={t("managerReview")} /></SectionCard>;
  const activeLines = detail.items.filter((line) => line.lineStatus === "active");
  const readOnly = detail.status !== "pending_approval";
  const reasonTitle = reasonIntent?.kind === "exclude" ? t("managerExcludeLine") : reasonIntent?.kind === "return" ? t("managerReturn") : t("managerReject");
  return <Box>
    <PageHeader eyebrow="PHASE 6 · MANAGER REVIEW" title={`${t("managerReview")} · ${detail.requestNumber}`} description={`${detail.branch.code} · ${detail.creator.username} · ${time(detail.submittedAt, i18n.language)}`} actions={<Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}><Button onClick={() => onNavigate("#/manager/requisitions")} variant="text">{t("managerBackToInbox")}</Button>{!readOnly && <><Button color="error" disabled={busy} onClick={() => beginReason({ kind: "reject" })} startIcon={<CancelOutlinedIcon />} variant="outlined">{t("managerReject")}</Button><Button color="warning" disabled={busy} onClick={() => beginReason({ kind: "return" })} startIcon={<KeyboardReturnOutlinedIcon />} variant="outlined">{t("managerReturn")}</Button><BusyButton busy={busy} disabled={!activeLines.length} onClick={() => setApproveOpen(true)} startIcon={<AssignmentTurnedInOutlinedIcon />} variant="contained">{t("managerApprove")}</BusyButton></>}</Box>} />
    {!online && <Alert severity="warning" sx={{ mb: 2 }}>{t("managerOffline")}</Alert>}
    {error && <Alert onClose={() => setError(null)} severity={conflict ? "warning" : "error"} sx={{ mb: 2 }}>{conflict ? t("managerStale") : error}{conflict && <Button onClick={() => void loadDetail()} size="small">{t("refresh")}</Button>}</Alert>}
    {readOnly && <Alert severity="info" sx={{ mb: 2 }}>{t("managerReadOnly")}</Alert>}
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1.2fr .8fr" } }}>
      <SectionCard title={t("managerLines")}><TableContainer component={Paper} variant="outlined"><Table size="small"><TableHead><TableRow><TableCell>{t("item")}</TableCell><TableCell>{t("supplier")}</TableCell><TableCell>{t("unit")}</TableCell><TableCell>{t("quantity")}</TableCell><TableCell>{t("status")}</TableCell><TableCell align="right">{t("actions")}</TableCell></TableRow></TableHead><TableBody>{detail.items.map((line) => <TableRow key={line.id}><TableCell>{localized(line.item, i18n.language)}<Typography color="text.secondary" sx={{ display: "block" }} variant="caption">{line.sku}</Typography></TableCell><TableCell>{line.supplierSnapshot.code}<Typography color="text.secondary" sx={{ display: "block" }} variant="caption">{line.supplierSnapshot.name}</Typography></TableCell><TableCell>{localized({ nameAr: line.unit.nameAr, nameEn: line.unit.nameEn }, i18n.language)}</TableCell><TableCell>{line.requestedQuantity}</TableCell><TableCell>{line.lineStatus === "active" ? <Chip color="success" label={t("active")} size="small" /> : <Chip label={t("managerExcluded")} size="small" />}{line.exclusion?.removalReason && <Typography color="text.secondary" sx={{ display: "block", maxWidth: 170 }} variant="caption">{line.exclusion.removalReason}</Typography>}</TableCell><TableCell align="right">{!readOnly && line.lineStatus === "active" && <Box sx={{ display: "inline-flex", gap: .5 }}><Button disabled={busy} onClick={() => void openEdit(line)} size="small" startIcon={<EditOutlinedIcon />}>{t("editRecord", { name: "" })}</Button><Button color="warning" disabled={busy} onClick={() => beginReason({ kind: "exclude", line })} size="small" startIcon={<BlockOutlinedIcon />}>{t("managerExclude")}</Button></Box>}</TableCell></TableRow>)}</TableBody></Table></TableContainer></SectionCard>
      <Box sx={{ display: "grid", gap: 2 }}><SectionCard title={t("managerRequestContext")}><Typography component="p"><strong>{t("branch")}:</strong> {detail.branch.code} · {localized({ nameAr: detail.branch.nameAr, nameEn: detail.branch.nameEn }, i18n.language)}</Typography><Typography component="p" sx={{ mt: 1 }}><strong>{t("creator")}:</strong> {detail.creator.username}</Typography><Typography component="p" sx={{ mt: 1 }}><strong>{t("submittedAt")}:</strong> {time(detail.submittedAt, i18n.language)}</Typography><Typography component="p" sx={{ mt: 1 }}><strong>{t("managerRowVersion")}:</strong> {detail.rowVersion}</Typography></SectionCard><SectionCard title={t("managerDecisionHistory")}>{!detail.statusHistory.length ? <EmptyState title={t("managerHistoryEmpty")} message={t("managerHistoryEmptyDescription")} /> : <Box sx={{ display: "grid", gap: 1 }}>{detail.statusHistory.map((entry) => <Paper key={entry.id} variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }} variant="body2">{entry.fromStatus ? t(entry.fromStatus) : "—"} → {t(entry.toStatus)}</Typography><Typography color="text.secondary" variant="caption">{entry.actor?.username ?? t("managerSystemActor")} · {time(entry.occurredAt, i18n.language)}</Typography>{entry.reason && <Typography variant="body2" sx={{ mt: .5 }}>{entry.reason}</Typography>}</Paper>)}</Box>}</SectionCard></Box>
    </Box>
    {editing && <Dialog fullWidth maxWidth="xs" onClose={() => setEditing(null)} open><DialogTitle>{t("managerEditLine")}</DialogTitle><DialogContent><Box sx={{ display: "grid", gap: 2, pt: 1 }}><Typography sx={{ fontWeight: 800 }}>{localized(editing.item, i18n.language)}</Typography><TextField label={t("quantity")} onChange={(event) => setQuantity(event.target.value)} required type="number" value={quantity} /><FormControl><InputLabel id="manager-unit">{t("unit")}</InputLabel><Select label={t("unit")} labelId="manager-unit" onChange={(event) => setUnitId(event.target.value)} value={unitId}>{units.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.code} · {localized({ nameAr: unit.nameAr, nameEn: unit.nameEn }, i18n.language)}</MenuItem>)}</Select></FormControl></Box></DialogContent><DialogActions><Button onClick={() => setEditing(null)}>{t("cancel")}</Button><BusyButton busy={busy} disabled={!unitId || Number(quantity) <= 0} onClick={() => void saveLine()} variant="contained">{t("save")}</BusyButton></DialogActions></Dialog>}
    {reasonIntent && <Dialog fullWidth maxWidth="xs" onClose={() => setReasonIntent(null)} open><DialogTitle>{reasonTitle}</DialogTitle><DialogContent><Typography color="text.secondary">{t(reasonIntent.kind === "exclude" ? "managerExcludeReasonHint" : "managerDecisionReasonHint")}</Typography><TextField autoFocus fullWidth label={t("managerReason")} multiline minRows={3} onChange={(event) => setReason(event.target.value)} required sx={{ mt: 2 }} value={reason} /></DialogContent><DialogActions><Button onClick={() => setReasonIntent(null)}>{t("cancel")}</Button><BusyButton busy={busy} color={reasonIntent.kind === "reject" ? "error" : "primary"} disabled={!reason.trim()} onClick={() => void confirmReason()} variant="contained">{t("confirm")}</BusyButton></DialogActions></Dialog>}
    {approveOpen && <Dialog fullWidth maxWidth="xs" onClose={() => setApproveOpen(false)} open><DialogTitle>{t("managerApprove")}</DialogTitle><DialogContent><Typography>{t("managerApproveNotice")}</Typography></DialogContent><DialogActions><Button onClick={() => setApproveOpen(false)}>{t("cancel")}</Button><BusyButton busy={busy} onClick={() => void approve()} variant="contained">{t("confirm")}</BusyButton></DialogActions></Dialog>}
  </Box>;
}
