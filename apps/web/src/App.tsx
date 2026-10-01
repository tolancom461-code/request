import { lazy, Suspense, type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
// Phase 10 lazy workspace boundary retains AdministrationWorkspace routing without eager bundle loading.
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import WifiOutlinedIcon from "@mui/icons-material/WifiOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import ShoppingCartOutlinedIcon from "@mui/icons-material/ShoppingCartOutlined";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import {
  BusyButton,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineNotice,
  PageContainer,
  PageHeader,
  ScopeDialog,
  SectionCard,
  StatusChip,
} from "./components/foundation";
import { resolveLocale } from "./theme";
import { adminNavigation } from "./components/admin-navigation";
import { AuditActivityWorkspace, Phase8NotificationButton } from "./components/notifications-audit";

const AdministrationWorkspace = lazy(async () => ({ default: (await import("./components/admin")).AdministrationWorkspace }));
const ItemsPage = lazy(async () => ({ default: (await import("./components/items")).ItemsPage }));
const RequisitionPage = lazy(async () => ({ default: (await import("./components/requisition")).RequisitionPage }));
const ManagerApprovalPage = lazy(async () => ({ default: (await import("./components/manager-approval")).ManagerApprovalPage }));
const WarehouseOperationsPage = lazy(async () => ({ default: (await import("./components/warehouse-operations")).WarehouseOperationsPage }));
const ReportsDashboardPage = lazy(async () => ({ default: (await import("./components/reports-dashboard")).ReportsDashboardPage }));

function RouteLoading() {
  const { t } = useTranslation();
  return <SectionCard><LoadingState message={t("loadingDescription")} title={t("loadingTitle")} /></SectionCard>;
}

type ApiState = "checking" | "ready" | "unavailable";
type AuthState = "checking" | "anonymous" | "authenticated" | "error";
type SessionUser = { id: string; username: string; email: string | null; permissions?: string[] };

const drawerWidth = 292;

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const data = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return data as T;
}

function LanguageMenu({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const { i18n, t } = useTranslation();
  const active = resolveLocale(i18n.language);
  return (
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={onClose}>
      {(["ar", "en", "ur"] as const).map((locale) => (
        <MenuItem key={locale} selected={locale === active} onClick={() => { void i18n.changeLanguage(locale); onClose(); }}>
          {locale.toUpperCase()}
        </MenuItem>
      ))}
    </Menu>
  );
}

export function LoginScreen({ error, busy, onSubmit }: { error: string | null; busy: boolean; onSubmit: (username: string, password: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [languageAnchor, setLanguageAnchor] = useState<HTMLElement | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (!username || !password) {
      setValidationError(t("loginRequiredFields"));
      return;
    }
    setValidationError(null);
    void onSubmit(username, password);
  };

  return (
    <Box component="main" sx={{ alignItems: "center", background: "linear-gradient(135deg, #EAF6F0 0%, #F7FAF8 58%, #FFF8E5 100%)", display: "flex", justifyContent: "center", maxWidth: "100%", minHeight: "100vh", overflowX: "hidden", p: { xs: 2, sm: 3 } }}>
      <Container maxWidth="lg" sx={{ p: "0 !important" }}>
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { lg: "minmax(0, 1.1fr) minmax(380px, .9fr)" }, minWidth: 0, width: "100%" }}>
        <Box sx={{ alignSelf: "center", p: { xs: 1, md: 4 } }}>
          <Chip color="secondary" label="VERDANT OPERATIONS" sx={{ fontWeight: 800, letterSpacing: ".08em" }} />
          <Typography component="h1" variant="h2" sx={{ color: "primary.dark", maxWidth: "100%", mt: 2, overflowWrap: "anywhere" }}>{t("title")}</Typography>
          <Typography color="text.secondary" sx={{ fontSize: "1.08rem", maxWidth: 600, mt: 2 }}>{t("description")}</Typography>
          <Box sx={{ borderInlineStart: "4px solid", borderColor: "secondary.main", mt: 4, ps: 2 }}>
            <Typography component="p" sx={{ fontWeight: 800 }}>{t("connectivity")}</Typography>
            <Typography color="text.secondary" variant="body2">{t("networkOnly")}</Typography>
          </Box>
        </Box>
        <Card component="section" sx={{ alignSelf: "center" }}>
          <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
            <Box sx={{ alignItems: "center", display: "flex", justifyContent: "space-between", mb: 3 }}>
              <Box>
                <Typography component="h2" variant="h5">{t("loginTitle")}</Typography>
                <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>{t("loginDescription")}</Typography>
              </Box>
              <IconButton aria-label={t("language")} color="primary" onClick={(event) => setLanguageAnchor(event.currentTarget)}><LanguageOutlinedIcon /></IconButton>
            </Box>
            {(validationError || error) && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{validationError || error}</Alert>}
            <Box component="form" noValidate onSubmit={submit} sx={{ display: "grid", gap: 2 }}>
              <TextField autoComplete="username" autoFocus disabled={busy} id="login-username" label={t("username")} name="username" required />
              <TextField autoComplete="current-password" disabled={busy} id="login-password" label={t("password")} name="password" required type="password" />
              <BusyButton busy={busy} fullWidth type="submit" variant="contained">{busy ? t("signingIn") : t("signIn")}</BusyButton>
            </Box>
          </CardContent>
        </Card>
      </Box>
      </Container>
      <LanguageMenu anchor={languageAnchor} onClose={() => setLanguageAnchor(null)} />
    </Box>
  );
}

function ApplicationShell({ user, sessionError, onRetry, onLogout }: { user: SessionUser; sessionError: string | null; onRetry: () => void; onLogout: () => Promise<void> }) {
  const { i18n, t } = useTranslation();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("lg"), { noSsr: true });
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [languageAnchor, setLanguageAnchor] = useState<HTMLElement | null>(null);
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);
  const [path, setPath] = useState(() => window.location.hash || "#dashboard");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [lastChecked, setLastChecked] = useState("");
  const locale = resolveLocale(i18n.language);
  const canManage = user.permissions?.includes("admin.manage") ?? false;
  const canRequest = user.permissions?.includes("request.submit") ?? false;
  const canReview = user.permissions?.includes("request.review") ?? false;
  const canWarehouse = user.permissions?.includes("warehouse.process") ?? false;
  const canReports = user.permissions?.includes("reports.view") ?? false;
  const canExportReports = user.permissions?.includes("reports.export") ?? false;
  const isAdminRoute = path.startsWith("#/admin/");
  const isRequisitionRoute = path === "#/requisitions";
  const isManagerRoute = path.startsWith("#/manager/requisitions");
  const isWarehouseRoute = path.startsWith("#/warehouse/requests");
  const isAuditRoute = path === "#/admin/audit" || path.startsWith("#/admin/user-activity");
  const isReportsRoute = path === "#/reports" || path.startsWith("#/reports/");

  useEffect(() => {
    const syncPath = () => setPath(window.location.hash || "#dashboard");
    window.addEventListener("hashchange", syncPath);
    return () => window.removeEventListener("hashchange", syncPath);
  }, []);

  const checkApi = useCallback(async () => {
    if (!navigator.onLine) { setApiState("unavailable"); return; }
    setApiState("checking");
    try {
      await getJson<{ status: string }>("/api/v1/health/live", { cache: "no-store" });
      setApiState("ready");
      setLastChecked(new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date()));
    } catch {
      setApiState("unavailable");
    }
  }, [locale]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); void checkApi(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [checkApi]);

  useEffect(() => {
    void checkApi();
    const timer = window.setInterval(() => void checkApi(), 30_000);
    return () => window.clearInterval(timer);
  }, [checkApi]);

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar sx={{ gap: 1.25 }}>
        <Avatar sx={{ bgcolor: "primary.main", fontWeight: 800 }}>R</Avatar>
        <Box><Typography component="p" sx={{ fontWeight: 800 }}>{t("workspace")}</Typography><Typography color="text.secondary" variant="caption">Verdant Operations</Typography></Box>
      </Toolbar>
      <Divider />
      <List component="nav" aria-label={t("navigation")} sx={{ px: 1, py: 1.5 }}>
        <ListItemButton component="a" href="#dashboard" selected={!isAdminRoute && !isRequisitionRoute && !isManagerRoute && !isWarehouseRoute && !isReportsRoute} onClick={() => setDrawerOpen(false)} sx={{ borderRadius: 2, minHeight: 48 }}>
          <ListItemIcon><DashboardOutlinedIcon color="primary" /></ListItemIcon>
          <ListItemText primary={t("dashboard")} />
        </ListItemButton>
        {canRequest && <ListItemButton component="a" href="#/requisitions" onClick={() => setDrawerOpen(false)} selected={isRequisitionRoute} sx={{ borderRadius: 2, minHeight: 48 }}><ListItemIcon><ShoppingCartOutlinedIcon color="primary" /></ListItemIcon><ListItemText primary={t("requisitions")} /></ListItemButton>}
        {canReview && <ListItemButton component="a" href="#/manager/requisitions" onClick={() => setDrawerOpen(false)} selected={isManagerRoute} sx={{ borderRadius: 2, minHeight: 48 }}><ListItemIcon><AssignmentTurnedInOutlinedIcon color="primary" /></ListItemIcon><ListItemText primary={t("managerInbox")} /></ListItemButton>}
        {canWarehouse && <ListItemButton component="a" href="#/warehouse/requests" onClick={() => setDrawerOpen(false)} selected={isWarehouseRoute} sx={{ borderRadius: 2, minHeight: 48 }}><ListItemIcon><WarehouseOutlinedIcon color="primary" /></ListItemIcon><ListItemText primary={t("warehouseQueue")} /></ListItemButton>}
        {canReports && <ListItemButton component="a" href="#/reports" onClick={() => setDrawerOpen(false)} selected={isReportsRoute} sx={{ borderRadius: 2, minHeight: 48 }}><ListItemIcon><AssessmentOutlinedIcon color="primary" /></ListItemIcon><ListItemText primary={t("reports")} /></ListItemButton>}
        {canManage && <>
          <Typography color="text.secondary" sx={{ px: 2, pt: 2 }} variant="overline">{t("administration")}</Typography>
          <ListItemButton component="a" href="#/admin/items" onClick={() => setDrawerOpen(false)} selected={path === "#/admin/items"} sx={{ borderRadius: 2, minHeight: 48 }}><ListItemIcon><SettingsOutlinedIcon color="primary" /></ListItemIcon><ListItemText primary={t("items")} /></ListItemButton>
          <ListItemButton component="a" href="#/admin/audit" onClick={() => setDrawerOpen(false)} selected={isAuditRoute} sx={{ borderRadius: 2, minHeight: 48 }}><ListItemIcon><HistoryOutlinedIcon color="primary" /></ListItemIcon><ListItemText primary={t("auditLog")} /></ListItemButton>
          <ListItemButton component="a" href="#/admin/user-activity" onClick={() => setDrawerOpen(false)} selected={path.startsWith("#/admin/user-activity")} sx={{ borderRadius: 2, minHeight: 48 }}><ListItemIcon><HistoryOutlinedIcon color="primary" /></ListItemIcon><ListItemText primary={t("userActivity")} /></ListItemButton>
          {adminNavigation.map((item) => <ListItemButton component="a" href={item.path} key={item.path} onClick={() => setDrawerOpen(false)} selected={path === item.path} sx={{ borderRadius: 2, minHeight: 48 }}><ListItemIcon><SettingsOutlinedIcon color="primary" /></ListItemIcon><ListItemText primary={t(item.key)} /></ListItemButton>)}
        </>}
      </List>
      <Box sx={{ mt: "auto", p: 2 }}>
        <Paper variant="outlined" sx={{ bgcolor: "primary.light", p: 1.5 }}>
          <Typography component="p" sx={{ fontWeight: 800 }} variant="body2">{t("scope")}</Typography>
          <Typography color="text.secondary" variant="caption">{t("scopeText")}</Typography>
        </Paper>
      </Box>
    </Box>
  );

  const serviceMessage = apiState === "checking" ? t("apiChecking") : apiState === "ready" ? t("apiReady") : t("apiUnavailable");
  // The RTL Emotion cache transforms physical left/right declarations. Keep one logical
  // source edge here so Arabic/Urdu become right-sided while English remains left-sided.
  const appBarOffset = { left: { md: 0 } };

  return (
    <Box sx={{ backgroundColor: "background.default", display: "flex", minHeight: "100vh" }}>
      <AppBar color="inherit" elevation={0} position="fixed" sx={{ ...appBarOffset, borderBottom: 1, borderColor: "divider", width: { md: `calc(100% - ${drawerWidth}px)` } }}>
        <Toolbar sx={{ gap: 1 }}>
          {compact && <IconButton aria-label={t("navigation")} color="primary" onClick={() => setDrawerOpen(true)}><MenuIcon /></IconButton>}
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography component="p" color="text.secondary" variant="caption">{t("workspace")}</Typography>
            <Typography component="h1" noWrap variant="h6" sx={{ fontWeight: 800 }}>{isReportsRoute ? t("reports") : isAuditRoute ? (path.startsWith("#/admin/user-activity") ? t("userActivity") : t("auditLog")) : isAdminRoute ? t("administration") : isWarehouseRoute ? t("warehouseQueue") : isManagerRoute ? t("managerInbox") : isRequisitionRoute ? t("requisitions") : t("dashboard")}</Typography>
          </Box>
          <StatusChip online={online && apiState === "ready"} label={online && apiState === "ready" ? t("onlineStatus") : t("offlineStatus")} />
          <Phase8NotificationButton online={online && apiState === "ready"} />
          <IconButton aria-label={t("language")} color="primary" onClick={(event) => setLanguageAnchor(event.currentTarget)}><LanguageOutlinedIcon /></IconButton>
          <IconButton aria-label={t("account")} onClick={(event) => setAccountAnchor(event.currentTarget)}><Avatar sx={{ bgcolor: "primary.dark", height: 34, width: 34 }}>{user.username.slice(0, 1).toUpperCase()}</Avatar></IconButton>
        </Toolbar>
      </AppBar>
      <Drawer anchor="left" ModalProps={{ keepMounted: true }} onClose={() => setDrawerOpen(false)} open={compact ? drawerOpen : true} sx={{ "& .MuiDrawer-paper": { boxSizing: "border-box", width: drawerWidth } }} variant={compact ? "temporary" : "permanent"}>{drawer}</Drawer>
      <Box sx={{ flexGrow: 1, marginLeft: { lg: `${drawerWidth}px` }, minWidth: 0 }}>
      <PageContainer>
        <Toolbar />
        <Box id="dashboard" sx={{ maxWidth: 1220, mx: "auto" }}>
          <Breadcrumbs aria-label="breadcrumb" sx={{ mb: 2 }}><Typography color="text.secondary" variant="body2">{t("workspace")}</Typography><Typography color="text.primary" variant="body2">{isReportsRoute ? t("reports") : isAuditRoute ? (path.startsWith("#/admin/user-activity") ? t("userActivity") : t("auditLog")) : isAdminRoute ? t("administration") : isWarehouseRoute ? t("warehouseQueue") : isManagerRoute ? t("managerInbox") : isRequisitionRoute ? t("requisitions") : t("dashboard")}</Typography></Breadcrumbs>
          {!online && <OfflineNotice message={t("offlineBanner")} />}
          {needRefresh && <Alert action={<Button color="inherit" onClick={() => void updateServiceWorker(true)} size="small">{t("refresh")}</Button>} role="status" severity="info" sx={{ mb: 2 }}>{t("updateAvailable")}</Alert>}
          <Suspense fallback={<RouteLoading />}>
          {sessionError ? <SectionCard><ErrorState action={<Button onClick={onRetry} startIcon={<RefreshOutlinedIcon />} variant="outlined">{t("retry")}</Button>} message={sessionError} title={t("sessionError")} /></SectionCard> : isReportsRoute ? (canReports ? <ReportsDashboardPage canExport={canExportReports} online={online && apiState === "ready"} path={path} /> : <SectionCard><ErrorState message={t("report.loadFailed")} title={t("reports")} /></SectionCard>) : isAuditRoute ? (canManage ? <AuditActivityWorkspace online={online && apiState === "ready"} path={path} /> : <SectionCard><ErrorState message={t("adminAccessDenied")} title={t("administration")} /></SectionCard>) : isAdminRoute ? (canManage ? (path === "#/admin/items" ? <ItemsPage online={online && apiState === "ready"} /> : <AdministrationWorkspace online={online && apiState === "ready"} path={path} />) : <SectionCard><ErrorState message={t("adminAccessDenied")} title={t("administration")} /></SectionCard>) : isWarehouseRoute ? (canWarehouse ? <WarehouseOperationsPage online={online && apiState === "ready"} onNavigate={(next) => { window.location.hash = next; }} path={path} /> : <SectionCard><ErrorState message={t("warehouseAccessDenied")} title={t("warehouseQueue")} /></SectionCard>) : isManagerRoute ? (canReview ? <ManagerApprovalPage online={online && apiState === "ready"} onNavigate={(next) => { window.location.hash = next; }} path={path} /> : <SectionCard><ErrorState message={t("managerAccessDenied")} title={t("managerInbox")} /></SectionCard>) : isRequisitionRoute ? (canRequest ? <RequisitionPage online={online && apiState === "ready"} /> : <SectionCard><ErrorState message={t("requisitionAccessDenied")} title={t("requisitions")} /></SectionCard>) : (
            <>
              <PageHeader actions={<Button onClick={() => setScopeOpen(true)} variant="outlined">{t("viewScope")}</Button>} description={t("welcomeDescription")} eyebrow="PHASE 2C · T3 + I1" title={t("welcome", { name: user.username })} />
              <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1.4fr 1fr" } }}>
                <SectionCard title={t("foundation")}>
                  <Typography color="text.secondary">{t("foundationDescription")}</Typography>
                  <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" }, mt: 2 }}>
                    <Paper variant="outlined" sx={{ p: 1.5 }}><Typography component="p" sx={{ fontWeight: 800 }} variant="body2">{t("connectivity")}</Typography><Typography color="text.secondary" variant="body2">{serviceMessage}{lastChecked ? ` · ${lastChecked}` : ""}</Typography></Paper>
                    <Paper variant="outlined" sx={{ p: 1.5 }}><Typography component="p" sx={{ fontWeight: 800 }} variant="body2">{t("pwa")}</Typography><Typography color="text.secondary" variant="body2">Online-First · Network Only</Typography></Paper>
                  </Box>
                </SectionCard>
                <SectionCard title={t("api")}>
                  <Box aria-live="polite">
                    {apiState === "checking" ? <LoadingState message={t("apiChecking")} title={t("connectivity")} /> : apiState === "unavailable" ? <ErrorState action={<Button onClick={() => void checkApi()} variant="outlined">{t("retry")}</Button>} message={t("apiUnavailable")} title={t("connectivity")} /> : <Alert icon={<WifiOutlinedIcon />} severity="success">{t("apiReady")}</Alert>}
                  </Box>
                </SectionCard>
              </Box>
              <Box sx={{ mt: 2 }}><SectionCard><EmptyState message={t("noModulesDescription")} title={t("noModules")} /></SectionCard></Box>
              <Box sx={{ mt: 2 }}><SectionCard title={t("foundation")}><TableContainer><Table aria-label={t("foundation")} size="small"><TableHead><TableRow><TableCell>{t("scope")}</TableCell><TableCell>{t("connectivity")}</TableCell></TableRow></TableHead><TableBody><TableRow><TableCell>{t("scopeText")}</TableCell><TableCell><Chip color={online ? "success" : "warning"} label={online ? t("onlineStatus") : t("offlineStatus")} size="small" /></TableCell></TableRow></TableBody></Table></TableContainer></SectionCard></Box>
            </>
          )}
          </Suspense>
        </Box>
      </PageContainer>
      </Box>
      <LanguageMenu anchor={languageAnchor} onClose={() => setLanguageAnchor(null)} />
      <Menu anchorEl={accountAnchor} open={Boolean(accountAnchor)} onClose={() => setAccountAnchor(null)}><MenuItem disabled>{user.email}</MenuItem><MenuItem onClick={() => { setAccountAnchor(null); void onLogout(); }}><ListItemIcon><LogoutOutlinedIcon fontSize="small" /></ListItemIcon>{t("signOut")}</MenuItem></Menu>
      <ScopeDialog closeLabel={t("close")} description={t("scopeDialogDescription")} onClose={() => setScopeOpen(false)} open={scopeOpen} title={t("scopeDialogTitle")} />
    </Box>
  );
}

export function App() {
  const { t } = useTranslation();
  const [state, setState] = useState<AuthState>("checking");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loginError, setLoginError] = useState<"invalidCredentials" | null>(null);
  const [sessionError, setSessionError] = useState<"sessionError" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadSession = useCallback(async () => {
    setState("checking");
    setSessionError(null);
    try {
      const response = await fetch("/api/v1/auth/me", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401 || response.status === 403) { setUser(null); setState("anonymous"); return; }
      if (!response.ok) throw new Error("session unavailable");
      const result = (await response.json()) as { user: SessionUser | null };
      if (!result.user) { setState("anonymous"); return; }
      setUser(result.user);
      setState("authenticated");
    } catch {
      setState("error");
      setSessionError("sessionError");
    }
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);

  const submitLogin = async (username: string, password: string) => {
    setSubmitting(true);
    setLoginError(null);
    try {
      await getJson<{ user: SessionUser }>("/api/v1/auth/login", { body: JSON.stringify({ username, password }), headers: { "Content-Type": "application/json" }, method: "POST" });
      await loadSession();
    } catch {
      setLoginError("invalidCredentials");
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    try {
      const csrf = await getJson<{ csrfToken: string }>("/api/v1/auth/csrf", { cache: "no-store" });
      await getJson<{ success: true }>("/api/v1/auth/logout", { headers: { "x-csrf-token": csrf.csrfToken }, method: "POST" });
      setUser(null);
      setState("anonymous");
    } catch {
      setSessionError("sessionError");
    }
  };

  if (state === "checking") return <Box component="main" sx={{ alignItems: "center", display: "flex", justifyContent: "center", minHeight: "100vh", p: 2 }}><Box sx={{ maxWidth: 520, width: "100%" }}><LoadingState message={t("loadingDescription")} title={t("loadingTitle")} /></Box></Box>;
  if (state === "anonymous") return <LoginScreen busy={submitting} error={loginError ? t(loginError) : null} onSubmit={submitLogin} />;
  if (state === "error" || !user) return <Box component="main" sx={{ alignItems: "center", display: "flex", justifyContent: "center", minHeight: "100vh", p: 2 }}><Box sx={{ maxWidth: 520, width: "100%" }}><SectionCard><ErrorState action={<Button onClick={() => void loadSession()} variant="contained">{t("retry")}</Button>} message={t(sessionError ?? "sessionError")} title={t("sessionError")} /></SectionCard></Box></Box>;
  return <ApplicationShell onLogout={logout} onRetry={() => void loadSession()} sessionError={sessionError ? t(sessionError) : null} user={user} />;
}
