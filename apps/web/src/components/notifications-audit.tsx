import { Fragment, type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert, Badge, Box, Button, Chip, CircularProgress, Divider, IconButton, List, ListItemButton, ListItemText, Menu, MenuItem,
  Pagination, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import DoneAllOutlinedIcon from "@mui/icons-material/DoneAllOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import { EmptyState, ErrorState, LoadingState, OfflineNotice, PageHeader, SectionCard } from "./foundation";

type Notice = { id: string; type: string; payload: { requestId?: string; requestNumber?: string; branch?: { code?: string; nameAr?: string; nameEn?: string }; route?: string; reason?: string; occurredAt?: string }; readAt: string | null; createdAt: string };
type AuditRow = { id: string; actorType: string; actorUserId: string | null; actorUser: { id: string; username: string; email: string } | null; entityType: string; entityId: string; action: string; beforeData: unknown; afterData: unknown; occurredAt: string };
type Page<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { cache: "no-store", credentials: "same-origin", ...init });
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return body as T;
}

async function csrf() { return api<{ csrfToken: string }>("/auth/csrf"); }

const eventKey: Record<string, string> = {
  "request.pending_approval": "notificationPending", "request.returned": "notificationReturned", "request.rejected": "notificationRejected", "request.approved": "notificationApproved",
  "warehouse.request_available": "notificationWarehouseAvailable", "warehouse.ready": "notificationReady", "warehouse.dispatched": "notificationDispatched", "warehouse.completed": "notificationCompleted",
};

function safeDate(value: string | null | undefined, locale: string) { return value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }

function NotificationCenter({ online }: { online: boolean }) {
  const { i18n, t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<Page<Notice> | null>(null);
  const [count, setCount] = useState(0);
  const [state, setState] = useState<"all" | "unread" | "read">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loadCount = useCallback(async () => { if (!online) return; try { setCount((await api<{ unreadCount: number }>("/notifications/unread-count")).unreadCount); } catch { /* compact indicator remains last known state */ } }, [online]);
  const load = useCallback(async () => {
    if (!online) return;
    setLoading(true); setError(false);
    try { const query = new URLSearchParams({ page: "1", pageSize: "24", state, direction: "desc" }); setData(await api<Page<Notice>>(`/notifications?${query}`)); await loadCount(); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [loadCount, online, state]);
  useEffect(() => { void loadCount(); const timer = window.setInterval(() => void loadCount(), 30_000); return () => window.clearInterval(timer); }, [loadCount]);
  useEffect(() => { if (anchor) void load(); }, [anchor, load]);

  const markOne = async (notice: Notice) => {
    if (!online || notice.readAt) { if (notice.payload.route) window.location.hash = notice.payload.route; return; }
    try {
      const token = await csrf(); await api(`/notifications/${notice.id}/read`, { method: "POST", headers: { "X-CSRF-Token": token.csrfToken } });
      setData((current) => current ? { ...current, items: current.items.map((item) => item.id === notice.id ? { ...item, readAt: new Date().toISOString() } : item) } : current);
      setCount((current) => Math.max(0, current - 1));
      if (notice.payload.route) window.location.hash = notice.payload.route;
    } catch { setError(true); }
  };
  const markAll = async () => {
    if (!online) return;
    try { const token = await csrf(); await api("/notifications/read-all", { method: "POST", headers: { "X-CSRF-Token": token.csrfToken } }); setData((current) => current ? { ...current, items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) } : current); setCount(0); }
    catch { setError(true); }
  };
  return <>
    <IconButton aria-label={t("notifications")} color="primary" onClick={(event) => setAnchor(event.currentTarget)}><Badge badgeContent={count} color="secondary" max={99}><NotificationsOutlinedIcon /></Badge></IconButton>
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { maxWidth: 440, width: "min(440px, calc(100vw - 24px))" } } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "space-between", px: 2, py: 1.5 }}><Box><Typography sx={{ fontWeight: 800 }}>{t("notificationCenter")}</Typography><Typography color="text.secondary" variant="caption">{t("notificationUnread", { count })}</Typography></Box><Button disabled={!online || !count} onClick={() => void markAll()} size="small" startIcon={<DoneAllOutlinedIcon />}>{t("markAllRead")}</Button></Box>
      <Divider />
      <Box sx={{ display: "flex", gap: 1, px: 2, py: 1 }}><Select aria-label={t("notificationFilter")} onChange={(event) => setState(event.target.value as typeof state)} size="small" value={state} sx={{ minWidth: 142 }}><MenuItem value="all">{t("notificationAll")}</MenuItem><MenuItem value="unread">{t("notificationUnreadOnly")}</MenuItem><MenuItem value="read">{t("notificationReadOnly")}</MenuItem></Select><IconButton aria-label={t("refresh")} disabled={!online || loading} onClick={() => void load()} size="small"><RefreshOutlinedIcon fontSize="small" /></IconButton></Box>
      {!online && <Box sx={{ px: 2, pb: 1 }}><OfflineNotice message={t("notificationOffline")} /></Box>}
      {error && <Box sx={{ px: 2, pb: 1 }}><Alert severity="error">{t("notificationLoadFailed")}</Alert></Box>}
      {loading ? <Box sx={{ p: 3, textAlign: "center" }}><CircularProgress size={24} /></Box> : !data?.items.length ? <Box sx={{ p: 2 }}><EmptyState message={t("notificationEmptyDescription")} title={t("notificationEmpty")} /></Box> : <List disablePadding sx={{ maxHeight: "min(62vh, 540px)", overflowY: "auto" }}>{data.items.map((notice) => <ListItemButton key={notice.id} onClick={() => void markOne(notice)} sx={{ alignItems: "flex-start", bgcolor: notice.readAt ? "transparent" : "secondary.light", borderBottom: 1, borderColor: "divider", gap: 1, px: 2, py: 1.5 }}><ListItemText primary={<Typography sx={{ fontWeight: notice.readAt ? 600 : 800 }}>{t(eventKey[notice.type] ?? "notifications")}</Typography>} secondary={<><span style={{ display: "block" }}>{notice.payload.requestNumber ?? "—"}{notice.payload.branch?.code ? ` · ${notice.payload.branch.code}` : ""}</span>{notice.payload.reason && <span style={{ display: "block" }}>{notice.payload.reason}</span>}<span style={{ display: "block" }}>{safeDate(notice.payload.occurredAt ?? notice.createdAt, i18n.language)}</span></>} /><Chip color={notice.readAt ? "default" : "secondary"} label={notice.readAt ? t("notificationRead") : t("notificationUnreadLabel")} size="small" /></ListItemButton>)}</List>}
    </Menu>
  </>;
}

function JsonBlock({ value }: { value: unknown }) { return <Paper component="pre" variant="outlined" sx={{ bgcolor: "background.default", fontFamily: "monospace", fontSize: 12, maxHeight: 220, overflow: "auto", p: 1.25, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{value == null ? "—" : JSON.stringify(value, null, 2)}</Paper>; }

function AuditTable({ data, locale, t }: { data: Page<AuditRow> | null; locale: string; t: (key: string, options?: any) => string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!data?.items.length) return <EmptyState message={t("auditEmptyDescription")} title={t("auditEmpty")} />;
  return <TableContainer><Table size="small"><TableHead><TableRow><TableCell>{t("occurredAt")}</TableCell><TableCell>{t("actor")}</TableCell><TableCell>{t("action")}</TableCell><TableCell>{t("entityType")}</TableCell><TableCell>{t("actions")}</TableCell></TableRow></TableHead><TableBody>{data.items.map((row) => <Fragment key={row.id}><TableRow hover><TableCell>{safeDate(row.occurredAt, locale)}</TableCell><TableCell>{row.actorUser?.username ?? t("managerSystemActor")}</TableCell><TableCell><Chip label={row.action} size="small" /></TableCell><TableCell>{row.entityType}</TableCell><TableCell><Button onClick={() => setExpanded(expanded === row.id ? null : row.id)} size="small">{t("auditDetail")}</Button></TableCell></TableRow>{expanded === row.id && <TableRow><TableCell colSpan={5}><Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}><Box><Typography sx={{ fontWeight: 800 }} variant="body2">{t("before")}</Typography><JsonBlock value={row.beforeData} /></Box><Box><Typography sx={{ fontWeight: 800 }} variant="body2">{t("after")}</Typography><JsonBlock value={row.afterData} /></Box></Box></TableCell></TableRow>}</Fragment>)}</TableBody></Table></TableContainer>;
}

export function AuditActivityWorkspace({ online, path }: { online: boolean; path: string }) {
  const { i18n, t } = useTranslation();
  const [data, setData] = useState<Page<AuditRow> | null>(null);
  const [activityUserId, setActivityUserId] = useState("");
  const [filters, setFilters] = useState({ action: "", entityType: "", search: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const isActivity = path.startsWith("#/admin/user-activity");
  const load = useCallback(async () => {
    if (!online) return;
    setLoading(true); setError(false);
    try {
      const query = new URLSearchParams({ page: "1", pageSize: "24", sort: "occurredAt", direction: "desc", ...(filters.action ? { action: filters.action } : {}), ...(filters.entityType ? { entityType: filters.entityType } : {}), ...(filters.search ? { search: filters.search } : {}) });
      const endpoint = isActivity && activityUserId ? `/admin/users/${activityUserId}/activity?${query}` : `/admin/audit-logs?${query}`;
      const result = await api<Page<AuditRow>>(endpoint); setData(result);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [activityUserId, filters, isActivity, online]);
  useEffect(() => { void load(); }, [load]);
  const update = (field: keyof typeof filters) => (event: ChangeEvent<HTMLInputElement>) => setFilters((current) => ({ ...current, [field]: event.target.value }));
  return <Box><PageHeader description={isActivity ? t("userActivityDescription") : t("auditDescription")} eyebrow="PHASE 8 · READ ONLY" title={isActivity ? t("userActivity") : t("auditLog")} />
    {!online && <OfflineNotice message={t("auditOffline")} />}
    <SectionCard title={t("auditFilters")}><Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 1.25 }}><TextField label={t("action")} onChange={update("action")} size="small" value={filters.action} /><TextField label={t("entityType")} onChange={update("entityType")} size="small" value={filters.entityType} /><TextField label={t("search")} onChange={update("search")} size="small" value={filters.search} />{isActivity && <TextField label={t("userActivityUserId")} onChange={(event) => setActivityUserId(event.target.value)} placeholder="UUID" size="small" value={activityUserId} />}<Button disabled={!online || loading || (isActivity && !activityUserId)} onClick={() => void load()} startIcon={<RefreshOutlinedIcon />} variant="outlined">{t("apply")}</Button></Box></SectionCard>
    <Box sx={{ mt: 2 }}><SectionCard title={isActivity ? t("userActivity") : t("auditLog")}><Typography color="text.secondary" sx={{ mb: 1.5 }} variant="body2">{t("auditReadOnly")}</Typography>{loading ? <LoadingState message={t("auditLoading")} title={isActivity ? t("userActivity") : t("auditLog")} /> : error ? <ErrorState action={<Button onClick={() => void load()} variant="outlined">{t("retry")}</Button>} message={t("auditLoadFailed")} title={isActivity ? t("userActivity") : t("auditLog")} /> : <AuditTable data={data} locale={i18n.language} t={t} />}{data && <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}><Pagination count={data.totalPages} page={data.page} /></Box>}</SectionCard></Box>
  </Box>;
}

export function Phase8NotificationButton({ online }: { online: boolean }) { return <NotificationCenter online={online} />; }
