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
import { notifySessionExpired, PAGE_PERMISSION_DENIED_EVENT, SESSION_EXPIRED_EVENT } from "./session-events";
import { brand } from "./brand";
import { resolveWorkspaceAccess } from "./workspace-access";
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
const workspaceIcons = {
  dashboard: DashboardOutlinedIcon,
  requisitions: ShoppingCartOutlinedIcon,
  manager: AssignmentTurnedInOutlinedIcon,
  warehouse: WarehouseOutlinedIcon,
  reports: AssessmentOutlinedIcon,
  items: SettingsOutlinedIcon,
  audit: HistoryOutlinedIcon,
  admin: SettingsOutlinedIcon,
};

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const data = (await response.json().catch(() => null)) as T | null;
  notifySessionExpired(response.status, data);
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
          <Chip color="secondary" label={t("brandShortName")} sx={{ fontWeight: 800 }} />
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
  const [requestedPath, setRequestedPath] = useState(() => window.location.hash);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [lastChecked, setLastChecked] = useState("");
  const locale = resolveLocale(i18n.language);
  const permissions = user.permissions ?? [];
  const { allowedRoutes, activeRoute, path } = resolveWorkspaceAccess(requestedPath, permissions);
  const title = t(activeRoute?.key ?? "workspace");
  const serviceOnline = online && apiState !== "unavailable";

  useEffect(() => {
    const syncPath = () => setRequestedPath(window.location.hash);
    window.addEventListener("hashchange", syncPath);
    return () => window.removeEventListener("hashchange", syncPath);
  }, []);

  useEffect(() => {
    if (!path || requestedPath === path || window.location.hash !== requestedPath) return;
    window.history.replaceState(window.history.state, "", path);
    setRequestedPath(path);
  }, [path, requestedPath]);

  const checkApi = useCallback(async () => {
    if (!navigator.onLine) { setApiState("unavailable"); return; }
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

  const renderNavigation = (administration: boolean) => allowedRoutes
    .filter(route => Boolean(route.administration) === administration)
    .map(route => {
      const Icon = workspaceIcons[route.view];
      return (
        <ListItemButton
          component="a"
          href={route.path}
          key={route.path}
          selected={activeRoute === route}
          onClick={() => setDrawerOpen(false)}
          sx={{ borderRadius: 2, minHeight: 48 }}
        >
          <ListItemIcon><Icon color="primary" /></ListItemIcon>
          <ListItemText primary={t(route.key)} />
        </ListItemButton>
      );
    });

  useEffect(() => {
    void checkApi();
    const timer = window.setInterval(() => void checkApi(), 30_000);
    return () => window.clearInterval(timer);
  }, [checkApi]);

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar sx={{ gap: 1.25 }}>
        <Avatar sx={{ bgcolor: "primary.main", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{brand.englishShortName}</Avatar>
        <Box sx={{ minWidth: 0, py: 1 }}><Typography component="p" sx={{ fontWeight: 800 }}>{t("brandShortName")}</Typography><Typography color="text.secondary" variant="caption" sx={{ display: "block", lineHeight: 1.6 }}>{t("title")}</Typography></Box>
      </Toolbar>
      <Divider />
      <List component="nav" aria-label={t("navigation")} sx={{ px: 1, py: 1.5 }}>
        {renderNavigation(false)}
        {allowedRoutes.some(route => route.administration) && <>
          <Typography color="text.secondary" sx={{ px: 2, pt: 2 }} variant="overline">{t("administration")}</Typography>
          {renderNavigation(true)}
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
            <Typography component="h1" noWrap variant="h6" sx={{ fontWeight: 800 }}>{title}</Typography>
          </Box>
          <StatusChip online={serviceOnline} label={serviceOnline ? t("onlineStatus") : t("offlineStatus")} />
          <Phase8NotificationButton online={serviceOnline} />
          <IconButton aria-label={t("language")} color="primary" onClick={(event) => setLanguageAnchor(event.currentTarget)}><LanguageOutlinedIcon /></IconButton>
          <IconButton aria-label={t("account")} onClick={(event) => setAccountAnchor(event.currentTarget)}><Avatar sx={{ bgcolor: "primary.dark", height: 34, width: 34 }}>{user.username.slice(0, 1).toUpperCase()}</Avatar></IconButton>
        </Toolbar>
      </AppBar>
      <Drawer anchor="left" ModalProps={{ keepMounted: true }} onClose={() => setDrawerOpen(false)} open={compact ? drawerOpen : true} sx={{ "& .MuiDrawer-paper": { boxSizing: "border-box", width: drawerWidth } }} variant={compact ? "temporary" : "permanent"}>{drawer}</Drawer>
      <Box sx={{ flexGrow: 1, marginLeft: { lg: `${drawerWidth}px` }, minWidth: 0 }}>
      <PageContainer>
        <Toolbar />
        <Box id="dashboard" sx={{ maxWidth: 1220, mx: "auto" }}>
          {activeRoute && <Breadcrumbs aria-label="breadcrumb" sx={{ mb: 2 }}><Typography color="text.secondary" variant="body2">{t("workspace")}</Typography><Typography color="text.primary" variant="body2">{title}</Typography></Breadcrumbs>}
          {!online && <OfflineNotice message={t("offlineBanner")} />}
          {needRefresh && <Alert action={<Button color="inherit" onClick={() => void updateServiceWorker(true)} size="small">{t("refresh")}</Button>} role="status" severity="info" sx={{ mb: 2 }}>{t("updateAvailable")}</Alert>}
          <Suspense fallback={<RouteLoading />}>
          {renderWorkspace()}
          </Suspense>
        </Box>
      </PageContainer>
      </Box>
      <LanguageMenu anchor={languageAnchor} onClose={() => setLanguageAnchor(null)} />
      <Menu anchorEl={accountAnchor} open={Boolean(accountAnchor)} onClose={() => setAccountAnchor(null)}><MenuItem disabled>{user.email}</MenuItem><MenuItem onClick={() => { setAccountAnchor(null); void onLogout(); }}><ListItemIcon><LogoutOutlinedIcon fontSize="small" /></ListItemIcon>{t("signOut")}</MenuItem></Menu>
      <ScopeDialog closeLabel={t("close")} description={t("scopeDialogDescription")} onClose={() => setScopeOpen(false)} open={scopeOpen} title={t("scopeDialogTitle")} />
    </Box>
  );

  function renderWorkspace() {
    if (sessionError) return <SectionCard><ErrorState action={<Button onClick={onRetry} startIcon={<RefreshOutlinedIcon />} variant="outlined">{t("retry")}</Button>} message={sessionError} title={t("sessionError")} /></SectionCard>;
    if (!activeRoute || !path) return <SectionCard><ErrorState message={t("noWorkspaceAccessDescription")} title={t("noWorkspaceAccess")} /></SectionCard>;
    const navigate = (next: string) => { window.location.hash = next; };
    switch (activeRoute.view) {
      case "requisitions": return <RequisitionPage online={serviceOnline} />;
      case "manager": return <ManagerApprovalPage online={serviceOnline} onNavigate={navigate} path={path} permissions={permissions} />;
      case "warehouse": return <WarehouseOperationsPage online={serviceOnline} onNavigate={navigate} path={path} />;
      case "reports": return <ReportsDashboardPage canExport={permissions.includes("reports.export")} online={serviceOnline} path={path} />;
      case "items": return <ItemsPage online={serviceOnline} />;
      case "audit": return <AuditActivityWorkspace online={serviceOnline} path={path} />;
      case "admin": return <AdministrationWorkspace online={serviceOnline} path={path} />;
      case "dashboard": return (
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
      );
    }
  }
}

export function App() {
  const { t } = useTranslation();
  const [state, setState] = useState<AuthState>("checking");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loginError, setLoginError] = useState<"invalidCredentials" | "sessionExpired" | null>(null);
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
      if (!result.user) { setUser(null); setState("anonymous"); return; }
      setUser(result.user);
      setState("authenticated");
    } catch {
      setState("error");
      setSessionError("sessionError");
    }
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);

  useEffect(() => {
    const expired = () => {
      setUser(null);
      setLoginError("sessionExpired");
      setState("anonymous");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, []);

  useEffect(() => {
    if (state !== "authenticated") return;
    let pending: AbortController | null = null;
    const refreshAccess = async () => {
      if (pending) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const response = await fetch("/api/v1/auth/me", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        } else if (response.ok) {
          const { user: updatedUser } = await response.json() as { user: SessionUser | null };
          if (!controller.signal.aborted && updatedUser) {
            setUser(current => current?.id === updatedUser.id ? updatedUser : current);
          }
        }
      } catch {
        // The page continues to show its own error if the refresh fails.
      } finally {
        pending = null;
      }
    };
    window.addEventListener(PAGE_PERMISSION_DENIED_EVENT, refreshAccess);
    return () => {
      window.removeEventListener(PAGE_PERMISSION_DENIED_EVENT, refreshAccess);
      pending?.abort();
    };
  }, [state]);

  const submitLogin = async (username: string, password: string) => {
    setSubmitting(true);
    setLoginError(null);
    try {
      const result = await getJson<{ user: SessionUser }>("/api/v1/auth/login", { body: JSON.stringify({ username, password }), headers: { "Content-Type": "application/json" }, method: "POST" });
      if (Array.isArray(result?.user?.permissions)) {
        setSessionError(null);
        setUser(result.user);
        setState("authenticated");
      } else {
        await loadSession();
      }
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
