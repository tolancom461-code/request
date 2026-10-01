import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, FormGroup, InputLabel, MenuItem, Pagination, Paper,
  Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LockResetOutlinedIcon from "@mui/icons-material/LockResetOutlined";
import { BusyButton, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard } from "./foundation";

// Phase 10 navigation boundary: #/admin/branches #/admin/suppliers #/admin/units #/admin/categories #/admin/users #/admin/roles

type Status = "active" | "inactive";
type ApiError = Error & { status?: number };
type PageResult<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };
type Item = Record<string, unknown> & { id: string; status?: Status };
type Field = { key: string; label: string; required?: boolean; type?: "text" | "email" | "password" };
type ModuleSpec = { key: "branches" | "suppliers" | "units" | "categories"; title: string; description: string; fields: Field[]; columns: string[] };

const moduleSpecs: ModuleSpec[] = [
  { key: "branches", title: "branches", description: "branchesDescription", fields: [{ key: "code", label: "code", required: true }, { key: "nameAr", label: "nameAr", required: true }, { key: "nameEn", label: "nameEn", required: true }], columns: ["code", "nameAr", "nameEn", "status"] },
  { key: "suppliers", title: "suppliers", description: "suppliersDescription", fields: [{ key: "supplierCode", label: "supplierCode", required: true }, { key: "supplierName", label: "supplierName", required: true }, { key: "taxNumber", label: "taxNumber" }], columns: ["supplierCode", "supplierName", "taxNumber", "status"] },
  { key: "units", title: "units", description: "unitsDescription", fields: [{ key: "code", label: "code", required: true }, { key: "nameAr", label: "nameAr", required: true }, { key: "nameEn", label: "nameEn" }], columns: ["code", "nameAr", "nameEn", "status"] },
  { key: "categories", title: "categories", description: "categoriesDescription", fields: [{ key: "code", label: "code", required: true }, { key: "nameAr", label: "nameAr", required: true }, { key: "nameEn", label: "nameEn" }], columns: ["code", "nameAr", "nameEn", "status"] },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body = await response.json().catch(() => null) as { message?: string } | T | null;
  if (!response.ok) {
    const error = new Error(typeof body === "object" && body && "message" in body ? String(body.message) : `HTTP ${response.status}`) as ApiError;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

async function mutation<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const csrf = await api<{ csrfToken: string }>("/api/v1/auth/csrf", { cache: "no-store" });
  return api<T>(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken }, body: JSON.stringify(body) });
}

function statusChip(t: (key: string) => string, status?: Status) {
  return <Chip color={status === "active" ? "success" : "default"} label={status === "active" ? t("active") : t("inactive")} size="small" />;
}

function fieldValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function MasterDataPage({ spec, online }: { spec: ModuleSpec; online: boolean }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<PageResult<Item> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | Status>("all");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ item: Item | null } | null>(null);
  const [confirm, setConfirm] = useState<Item | null>(null);

  const load = useCallback(async () => {
    if (!online) return;
    setLoading(true); setError(null);
    const query = new URLSearchParams({ page: String(page), pageSize: "20", sortBy: spec.columns[0] ?? "code", sortDir: "asc" });
    if (search.trim()) query.set("search", search.trim());
    if (status !== "all") query.set("status", status);
    try { setResult(await api<PageResult<Item>>(`/api/v1/admin/${spec.key}?${query}`)); } catch (caught) { setError(errorMessage(caught, "Administrative data could not be loaded.")); } finally { setLoading(false); }
  }, [online, page, search, spec.columns, spec.key, status]);

  useEffect(() => { void load(); }, [load]);

  const changeStatus = async () => {
    if (!confirm) return;
    try { await mutation(`/api/v1/admin/${spec.key}/${confirm.id}/status`, "POST", { status: confirm.status === "active" ? "inactive" : "active" }); setConfirm(null); await load(); } catch (caught) { setError(errorMessage(caught, t("saveFailed"))); setConfirm(null); }
  };

  return (
    <Box>
      <PageHeader eyebrow="PHASE 3 · MASTER DATA" title={t(spec.title)} description={t(spec.description)} actions={<Button disabled={!online} onClick={() => setDialog({ item: null })} startIcon={<AddOutlinedIcon />} variant="contained">{t("create")}</Button>} />
      <SectionCard>
        <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 1.5, mb: 2 }}>
          <TextField fullWidth label={t("search")} onChange={(event) => { setPage(1); setSearch(event.target.value); }} value={search} />
          <FormControl sx={{ minWidth: 180 }}><InputLabel id={`${spec.key}-status`}>{t("status")}</InputLabel><Select label={t("status")} labelId={`${spec.key}-status`} onChange={(event) => { setPage(1); setStatus(event.target.value as "all" | Status); }} value={status}><MenuItem value="all">{t("allStatuses")}</MenuItem><MenuItem value="active">{t("active")}</MenuItem><MenuItem value="inactive">{t("inactive")}</MenuItem></Select></FormControl>
          <Button onClick={() => void load()} variant="outlined">{t("apply")}</Button>
        </Box>
        {!online && <Alert severity="warning" sx={{ mb: 2 }}>{t("adminOffline")}</Alert>}
        {loading ? <LoadingState title={t("loadingTitle")} message={t("loadingDescription")} /> : error ? <ErrorState action={<Button onClick={() => void load()} variant="outlined">{t("retry")}</Button>} message={error} title={t("loadFailed")} /> : !result?.items.length ? <EmptyState title={t("emptyTitle")} message={t("emptyDescription")} /> : (
          <>
            <TableContainer component={Paper} variant="outlined"><Table aria-label={t(spec.title)} size="small"><TableHead><TableRow>{spec.columns.map((column) => <TableCell key={column}>{t(column)}</TableCell>)}<TableCell align="right">{t("actions")}</TableCell></TableRow></TableHead><TableBody>{result.items.map((item) => <TableRow key={item.id} hover><>{spec.columns.map((column) => <TableCell key={column}>{column === "status" ? statusChip(t, item.status as Status) : fieldValue(item[column])}</TableCell>)}</><TableCell align="right"><Button onClick={() => setDialog({ item })} size="small" startIcon={<EditOutlinedIcon />}>{t("manage")}</Button><Button color={item.status === "active" ? "warning" : "success"} onClick={() => setConfirm(item)} size="small">{item.status === "active" ? t("deactivate") : t("activate")}</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>
            <Box sx={{ alignItems: "center", display: "flex", justifyContent: "space-between", mt: 2 }}><Typography color="text.secondary" variant="body2">{t("records", { count: result.total })}</Typography><Pagination count={result.totalPages} onChange={(_, value) => setPage(value)} page={result.page} /></Box>
          </>
        )}
      </SectionCard>
      {dialog && <MasterDataDialog item={dialog.item} online={online} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await load(); }} spec={spec} />}
      <Dialog fullWidth maxWidth="xs" onClose={() => setConfirm(null)} open={Boolean(confirm)}><DialogTitle>{confirm?.status === "active" ? t("confirmDeactivate") : t("confirmActivate")}</DialogTitle><DialogContent><Typography>{t("statusChangeDescription")}</Typography></DialogContent><DialogActions><Button onClick={() => setConfirm(null)}>{t("cancel")}</Button><Button color={confirm?.status === "active" ? "warning" : "success"} onClick={() => void changeStatus()} variant="contained">{t("confirm")}</Button></DialogActions></Dialog>
    </Box>
  );
}

function MasterDataDialog({ spec, item, online, onClose, onSaved }: { spec: ModuleSpec; item: Item | null; online: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(spec.fields.map((field) => [field.key, item?.[field.key] ? String(item[field.key]) : ""])));
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!online) return; setBusy(true); setError(null);
    try {
      const body = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === "" && !spec.fields.find((field) => field.key === key)?.required ? null : value]));
      await mutation(`/api/v1/admin/${spec.key}${item ? `/${item.id}` : ""}`, item ? "PATCH" : "POST", body); await onSaved();
    } catch (caught) { setError(errorMessage(caught, t("saveFailed"))); } finally { setBusy(false); }
  };
  return <Dialog fullWidth maxWidth="sm" onClose={onClose} open><Box component="form" onSubmit={save}><DialogTitle>{item ? t("editRecord", { name: t(spec.title) }) : t("createRecord", { name: t(spec.title) })}</DialogTitle><DialogContent><Box sx={{ display: "grid", gap: 2, pt: 1 }}>{error && <Alert severity="error">{error}</Alert>}{spec.fields.map((field) => <TextField disabled={busy || !online} key={field.key} label={t(field.label)} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} required={field.required} type={field.type ?? "text"} value={values[field.key] ?? ""} />)}</Box></DialogContent><DialogActions><Button disabled={busy} onClick={onClose}>{t("cancel")}</Button><BusyButton busy={busy} disabled={!online} type="submit" variant="contained">{t("save")}</BusyButton></DialogActions></Box></Dialog>;
}

type Role = { id: string; code: string; name: string; description?: string | null; _count?: { userRoles: number; permissions: number } };
type BranchOption = { id: string; code: string; nameAr: string; nameEn: string; status: Status };
type UserDetail = Item & { username: string; email: string | null; roles: { role: Role }[]; branchScopes: { branch: BranchOption }[] };

export function UsersPage({ online }: { online: boolean }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<PageResult<Item> | null>(null); const [roles, setRoles] = useState<Role[]>([]); const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [dialog, setDialog] = useState<{ user: UserDetail | null } | null>(null); const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    if (!online) return; setLoading(true); setError(null);
    try {
      const [users, roleData, branchData] = await Promise.all([api<PageResult<Item>>(`/api/v1/admin/users?page=1&pageSize=50&sortBy=username&sortDir=asc${search ? `&search=${encodeURIComponent(search)}` : ""}`), api<Role[]>("/api/v1/admin/roles"), api<PageResult<BranchOption>>("/api/v1/admin/branches?page=1&pageSize=100&status=active&sortBy=code&sortDir=asc")]);
      setResult(users); setRoles(roleData); setBranches(branchData.items);
    } catch (caught) { setError(errorMessage(caught, "Administrative data could not be loaded.")); } finally { setLoading(false); }
  }, [online, search]);
  useEffect(() => { void load(); }, [load]);
  const openUser = async (id: string) => { try { setDialog({ user: await api<UserDetail>(`/api/v1/admin/users/${id}`) }); } catch (caught) { setError(errorMessage(caught, "Administrative data could not be loaded.")); } };
  return <Box><PageHeader eyebrow="PHASE 3 · ADMINISTRATION" title={t("users")} description={t("usersDescription")} actions={<Button disabled={!online} onClick={() => setDialog({ user: null })} startIcon={<AddOutlinedIcon />} variant="contained">{t("create")}</Button>} /><SectionCard><Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 1.5, mb: 2 }}><TextField fullWidth label={t("search")} onChange={(event) => setSearch(event.target.value)} value={search} /><Button onClick={() => void load()} variant="outlined">{t("apply")}</Button></Box>{loading ? <LoadingState title={t("loadingTitle")} message={t("loadingDescription")} /> : error ? <ErrorState action={<Button onClick={() => void load()} variant="outlined">{t("retry")}</Button>} message={error} title={t("loadFailed")} /> : !result?.items.length ? <EmptyState title={t("emptyTitle")} message={t("emptyDescription")} /> : <TableContainer component={Paper} variant="outlined"><Table aria-label={t("users")} size="small"><TableHead><TableRow><TableCell>{t("username")}</TableCell><TableCell>{t("email")}</TableCell><TableCell>{t("roles")}</TableCell><TableCell>{t("status")}</TableCell><TableCell align="right">{t("actions")}</TableCell></TableRow></TableHead><TableBody>{result.items.map((user) => <TableRow hover key={user.id}><TableCell>{fieldValue(user.username)}</TableCell><TableCell>{fieldValue(user.email)}</TableCell><TableCell>{Array.isArray(user.roles) ? (user.roles as { code: string }[]).map((role) => role.code).join(", ") : "—"}</TableCell><TableCell>{statusChip(t, user.status as Status)}</TableCell><TableCell align="right"><Button onClick={() => void openUser(user.id)} size="small" startIcon={<EditOutlinedIcon />}>{t("manage")}</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>}</SectionCard>{dialog && <UserDialog branches={branches} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await load(); }} roles={roles} online={online} user={dialog.user} />}</Box>;
}

function UserDialog({ user, roles, branches, online, onClose, onSaved }: { user: UserDetail | null; roles: Role[]; branches: BranchOption[]; online: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(user?.username ?? ""); const [email, setEmail] = useState(user?.email ?? ""); const [password, setPassword] = useState(""); const [status, setStatus] = useState<Status>(user?.status as Status ?? "active");
  const [roleIds, setRoleIds] = useState<string[]>(() => user?.roles.map((entry) => entry.role.id) ?? []); const [branchIds, setBranchIds] = useState<string[]>(() => user?.branchScopes.map((entry) => entry.branch.id) ?? []); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const toggle = (setter: (next: string[]) => void, values: string[], id: string) => setter(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  const save = async (event: FormEvent) => { event.preventDefault(); if (!online) return; setBusy(true); setError(null); try {
    if (!user) { await mutation("/api/v1/admin/users", "POST", { username, email: email.trim() || null, password, status, roleIds, branchIds }); } else { await mutation(`/api/v1/admin/users/${user.id}`, "PATCH", { username, email: email.trim() || null, status }); await mutation(`/api/v1/admin/users/${user.id}/roles`, "POST", { ids: roleIds }); await mutation(`/api/v1/admin/users/${user.id}/branch-scopes`, "POST", { ids: branchIds }); if (password) await mutation(`/api/v1/admin/users/${user.id}/password`, "POST", { password }); }
    await onSaved();
  } catch (caught) { setError(errorMessage(caught, t("saveFailed"))); } finally { setBusy(false); } };
  return <Dialog fullWidth maxWidth="md" onClose={onClose} open><Box component="form" onSubmit={save}><DialogTitle>{user ? t("manageUser") : t("createUser")}</DialogTitle><DialogContent><Box sx={{ display: "grid", gap: 2, pt: 1 }}>{error && <Alert severity="error">{error}</Alert>}<Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}><TextField disabled={busy || !online} label={t("username")} onChange={(event) => setUsername(event.target.value)} required value={username} /><TextField disabled={busy || !online} label={t("email")} onChange={(event) => setEmail(event.target.value)} type="email" value={email} /><TextField disabled={busy || !online} helperText={user ? t("passwordOptional") : t("passwordMinimum")} label={user ? t("resetPassword") : t("password")} onChange={(event) => setPassword(event.target.value)} required={!user} type="password" value={password} /><FormControl><InputLabel id="user-status">{t("status")}</InputLabel><Select label={t("status")} labelId="user-status" onChange={(event) => setStatus(event.target.value as Status)} value={status}><MenuItem value="active">{t("active")}</MenuItem><MenuItem value="inactive">{t("inactive")}</MenuItem></Select></FormControl></Box><Typography component="h3" variant="subtitle1">{t("roles")}</Typography><FormGroup row>{roles.map((role) => <FormControlLabel control={<Checkbox checked={roleIds.includes(role.id)} onChange={() => toggle(setRoleIds, roleIds, role.id)} />} key={role.id} label={`${role.name} (${role.code})`} />)}</FormGroup><Typography component="h3" variant="subtitle1">{t("branchScopes")}</Typography><FormGroup row>{branches.map((branch) => <FormControlLabel control={<Checkbox checked={branchIds.includes(branch.id)} onChange={() => toggle(setBranchIds, branchIds, branch.id)} />} key={branch.id} label={`${branch.code} · ${branch.nameAr}`} />)}</FormGroup></Box></DialogContent><DialogActions><Button disabled={busy} onClick={onClose}>{t("cancel")}</Button><BusyButton busy={busy} disabled={!online || roleIds.length === 0} type="submit" variant="contained">{t("save")}</BusyButton></DialogActions></Box></Dialog>;
}

export function RolesPage({ online }: { online: boolean }) {
  const { t } = useTranslation(); const [roles, setRoles] = useState<Role[]>([]); const [permissions, setPermissions] = useState<{ id: string; code: string; name: string }[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [dialog, setDialog] = useState<Role | null | undefined>(undefined);
  const load = useCallback(async () => { if (!online) return; setLoading(true); setError(null); try { const [roleData, permissionData] = await Promise.all([api<Role[]>("/api/v1/admin/roles"), api<{ id: string; code: string; name: string }[]>("/api/v1/admin/permissions")]); setRoles(roleData); setPermissions(permissionData); } catch (caught) { setError(errorMessage(caught, "Administrative data could not be loaded.")); } finally { setLoading(false); } }, [online]);
  useEffect(() => { void load(); }, [load]);
  return <Box><PageHeader eyebrow="PHASE 3 · ADMINISTRATION" title={t("rolesPermissions")} description={t("rolesDescription")} actions={<Button disabled={!online} onClick={() => setDialog(null)} startIcon={<AddOutlinedIcon />} variant="contained">{t("createRole")}</Button>} /><SectionCard>{loading ? <LoadingState title={t("loadingTitle")} message={t("loadingDescription")} /> : error ? <ErrorState action={<Button onClick={() => void load()} variant="outlined">{t("retry")}</Button>} message={error} title={t("loadFailed")} /> : <TableContainer component={Paper} variant="outlined"><Table aria-label={t("rolesPermissions")} size="small"><TableHead><TableRow><TableCell>{t("code")}</TableCell><TableCell>{t("name")}</TableCell><TableCell>{t("assignedUsersColumn")}</TableCell><TableCell>{t("permissions")}</TableCell><TableCell align="right">{t("actions")}</TableCell></TableRow></TableHead><TableBody>{roles.map((role) => <TableRow hover key={role.id}><TableCell>{role.code}</TableCell><TableCell>{role.name}</TableCell><TableCell>{role._count?.userRoles ?? 0}</TableCell><TableCell>{role._count?.permissions ?? 0}</TableCell><TableCell align="right"><Button onClick={() => setDialog(role)} size="small" startIcon={<EditOutlinedIcon />}>{t("manage")}</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer>}</SectionCard>{dialog !== undefined && <RoleDialog role={dialog} permissions={permissions} online={online} onClose={() => setDialog(undefined)} onSaved={async () => { setDialog(undefined); await load(); }} />}</Box>;
}

function RoleDialog({ role, permissions, online, onClose, onSaved }: { role: Role | null; permissions: { id: string; code: string; name: string }[]; online: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation(); const [detail, setDetail] = useState<{ id: string; code: string; name: string; description?: string | null; permissions: { id: string }[] } | null>(null); const [code, setCode] = useState(role?.code ?? ""); const [name, setName] = useState(role?.name ?? ""); const [description, setDescription] = useState(role?.description ?? ""); const [permissionIds, setPermissionIds] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!role) return; void api<typeof detail>(`/api/v1/admin/roles/${role.id}`).then((data) => { setDetail(data); setName(data?.name ?? ""); setDescription(data?.description ?? ""); setPermissionIds(data?.permissions.map((permission) => permission.id) ?? []); }).catch((caught) => setError(errorMessage(caught, "Administrative data could not be loaded."))); }, [role]);
  const toggle = (id: string) => setPermissionIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const save = async (event: FormEvent) => { event.preventDefault(); if (!online) return; setBusy(true); setError(null); try { if (!role) { await mutation("/api/v1/admin/roles", "POST", { code, name, description: description || null }); } else if (role.code.startsWith("system_") || ["branch_employee", "branch_manager", "warehouse_manager"].includes(role.code)) { await mutation(`/api/v1/admin/roles/${role.id}/permissions`, "POST", { ids: permissionIds }); } else { await mutation(`/api/v1/admin/roles/${role.id}`, "PATCH", { name, description: description || null }); await mutation(`/api/v1/admin/roles/${role.id}/permissions`, "POST", { ids: permissionIds }); } await onSaved(); } catch (caught) { setError(errorMessage(caught, t("saveFailed"))); } finally { setBusy(false); } };
  const builtIn = Boolean(role && ["system_admin", "branch_employee", "branch_manager", "warehouse_manager"].includes(role.code));
  return <Dialog fullWidth maxWidth="md" onClose={onClose} open><Box component="form" onSubmit={save}><DialogTitle>{role ? t("manageRole") : t("createRole")}</DialogTitle><DialogContent><Box sx={{ display: "grid", gap: 2, pt: 1 }}>{error && <Alert severity="error">{error}</Alert>}<Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}><TextField disabled={busy || !online || Boolean(role)} label={t("code")} onChange={(event) => setCode(event.target.value)} required value={code} /><TextField disabled={busy || !online || builtIn} label={t("name")} onChange={(event) => setName(event.target.value)} required value={name} /></Box><TextField disabled={busy || !online || builtIn} label={t("descriptionField")} multiline onChange={(event) => setDescription(event.target.value)} rows={2} value={description} /><Typography component="h3" variant="subtitle1">{t("permissions")}</Typography>{builtIn && <Alert severity="info">{t("builtInRoleNotice")}</Alert>}<FormGroup row>{permissions.map((permission) => <FormControlLabel control={<Checkbox checked={permissionIds.includes(permission.id)} onChange={() => toggle(permission.id)} />} key={permission.id} label={`${permission.name} (${permission.code})`} />)}</FormGroup>{detail && <Typography color="text.secondary" variant="body2">{t("assignedUsers", { count: (detail as unknown as { users?: unknown[] }).users?.length ?? 0 })}</Typography>}</Box></DialogContent><DialogActions><Button disabled={busy} onClick={onClose}>{t("cancel")}</Button><BusyButton busy={busy} disabled={!online || (!role && !code)} type="submit" variant="contained">{t("save")}</BusyButton></DialogActions></Box></Dialog>;
}

export function AdministrationWorkspace({ path, online }: { path: string; online: boolean }) {
  const spec = useMemo(() => moduleSpecs.find((candidate) => path.endsWith(candidate.key)), [path]);
  if (spec) return <MasterDataPage online={online} spec={spec} />;
  if (path.endsWith("users")) return <UsersPage online={online} />;
  return <RolesPage online={online} />;
}
