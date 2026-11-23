import { I18nextProvider } from "react-i18next";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "./i18n";
import { notifyApiAccess, notifySessionExpired } from "./session-events";

vi.mock("./components/admin", () => ({ AdministrationWorkspace: () => <div data-testid="admin-workspace">Admin workspace</div> }));
vi.mock("./components/items", () => ({ ItemsPage: () => <div data-testid="items-page">Items</div> }));
vi.mock("./components/requisition", () => ({ RequisitionPage: () => <div data-testid="requisition-page">Requisitions</div> }));
vi.mock("./components/manager-approval", () => ({ ManagerApprovalPage: ({ path }: { path: string }) => <div data-testid="manager-page" data-path={path}>Manager review</div> }));
vi.mock("./components/warehouse-operations", () => ({ WarehouseOperationsPage: () => <div data-testid="warehouse-page">Warehouse queue</div> }));
vi.mock("./components/reports-dashboard", () => ({ ReportsDashboardPage: ({ online }: { online: boolean }) => <div data-testid="reports-page" data-online={String(online)}>Reports dashboard</div> }));

const permissions = ["admin.manage", "branch.read", "request.submit", "request.review", "warehouse.process", "reports.view", "reports.export"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

function setGrants(grants: string[]) {
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((input, init) => String(input).endsWith("/api/v1/auth/me")
    ? Promise.resolve(json({ user: { id: "u-dom", username: "dom-user", email: null, permissions: grants } }))
    : normalFetch(input, init));
}

describe("Phase 10 rendered shell harness", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/api/v1/auth/me")) return json({ user: { id: "u-dom", username: "dom-user", email: "dom@example.test", permissions } });
      if (path.includes("/api/v1/health/live")) return json({ status: "ok" });
      if (path.includes("/api/v1/notifications/count")) return json({ unreadCount: 0 });
      if (path.includes("/api/v1/notifications")) return json({ items: [], total: 0 });
      return json({ csrfToken: "csrf-dom" });
    }));
  });

  test("blocks empty login submission with a localized validation message", async () => {
    const { LoginScreen } = await import("./App");
    const submit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<I18nextProvider i18n={i18n}><LoginScreen busy={false} error={null} onSubmit={submit} /></I18nextProvider>);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Enter both your username and password");
  });

  test("submits the actual login form fields", async () => {
    const { LoginScreen } = await import("./App");
    const submit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<I18nextProvider i18n={i18n}><LoginScreen busy={false} error={null} onSubmit={submit} /></I18nextProvider>);
    await user.type(screen.getByLabelText(/Username/), "employee1");
    await user.type(screen.getByLabelText(/Password/), "safe-test-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(submit).toHaveBeenCalledWith("employee1", "safe-test-password");
  });

  test("renders only authorized navigation and lazily reaches each protected workspace route", async () => {
    const { App } = await import("./App");
    const user = userEvent.setup();
    render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>);

    const reports = await screen.findByRole("link", { name: "Reports" });
    expect(screen.getByRole("link", { name: "Manager review inbox" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Warehouse queue" })).toBeTruthy();

    await user.click(reports);
    await screen.findByTestId("reports-page");

    window.location.hash = "#/manager/requisitions";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await screen.findByTestId("manager-page");

    window.location.hash = "#/warehouse/requests";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await screen.findByTestId("warehouse-page");
  });

  test("does not render restricted workflow navigation for a reports-only user", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/api/v1/auth/me")) return json({ user: { id: "u-report", username: "report-user", email: "report@example.test", permissions: ["reports.view"] } });
      if (path.includes("/api/v1/health/live")) return json({ status: "ok" });
      if (path.includes("/api/v1/notifications/count")) return json({ unreadCount: 0 });
      return json({ items: [], total: 0 });
    }));
    const { App } = await import("./App");
    render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>);
    await screen.findByRole("link", { name: "Reports" });
    await waitFor(() => expect(screen.queryByRole("link", { name: "Manager review inbox" })).toBeNull());
    expect(screen.queryByRole("link", { name: "Warehouse queue" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Branch requisitions" })).toBeNull();
  });

  test("redirects a denied deep link to the first allowed menu entry, including during navigation", async () => {
    window.location.hash = "#/reports/warehouse";
    setGrants(["request.review", "request.submit", "branch.read"]);
    const { App } = await import("./App");
    render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>);
    await screen.findByTestId("requisition-page");
    expect(window.location.hash).toBe("#/requisitions");
    const links = within(screen.getByRole("navigation", { name: "Navigation" })).getAllByRole("link");
    expect(links.map(link => link.getAttribute("href"))).toEqual(["#/requisitions", "#/manager/requisitions"]);
    expect(screen.queryByTestId("reports-page")).toBeNull();

    act(() => {
      window.location.hash = "#/admin/items";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(window.location.hash).toBe("#/requisitions"));
    expect(screen.queryByTestId("items-page")).toBeNull();
  });

  test("retains a permitted detail link and uses grants returned by login without another session request", async () => {
    const path = "#/manager/requisitions/10000000-0000-4000-8000-000000000001/review";
    window.location.hash = path;
    const normalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input).endsWith("/api/v1/auth/me")) return Promise.resolve(json({}, 401));
      if (String(input).endsWith("/api/v1/auth/login")) {
        return Promise.resolve(json({ user: { id: "u-dom", username: "dom-user", email: null, permissions: ["request.review"] } }));
      }
      return normalFetch(input, init);
    });
    const { App } = await import("./App");
    const user = userEvent.setup();
    render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>);
    await user.type(await screen.findByLabelText(/Username/), "dom-user");
    await user.type(screen.getByLabelText(/Password/), "safe-test-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByTestId("manager-page")).getAttribute("data-path")).toBe(path);
    expect(window.location.hash).toBe(path);
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith("/api/v1/auth/me"))).toHaveLength(1);
  });

  test("shows a no-access state without opening a protected page when no view is granted", async () => {
    window.location.hash = "#/admin/items";
    setGrants(["profile.read", "request.approve", "reports.export"]);
    const { App } = await import("./App");
    render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>);
    await screen.findByText("Your account has no accessible pages");
    expect(within(screen.getByRole("navigation", { name: "Navigation" })).queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByTestId("items-page")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  test("rechecks revoked page access in the background and ignores branch and action denials", async () => {
    window.location.hash = "#/reports/branches";
    setGrants(["reports.view", "request.submit", "branch.read"]);
    const { App } = await import("./App");
    render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>);
    await screen.findByTestId("reports-page");
    setGrants(["request.submit", "branch.read"]);
    const sessionReads = () => vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith("/api/v1/auth/me")).length;
    const denied = { code: "PERMISSION_REQUIRED", message: "Required permission is missing." };
    act(() => {
      notifyApiAccess(403, { message: "The user is not authorized for this branch." });
      notifyApiAccess(403, denied, "POST");
    });
    expect(sessionReads()).toBe(1);
    expect(screen.getByTestId("reports-page")).toBeTruthy();
    act(() => {
      notifyApiAccess(403, denied);
      notifyApiAccess(403, denied);
    });
    await screen.findByTestId("requisition-page");
    expect(sessionReads()).toBe(2);
    expect(window.location.hash).toBe("#/requisitions");
    expect(screen.queryByRole("link", { name: "Reports" })).toBeNull();
  });

  test.each(["en", "ar"])("requests sign-in in %s after authentication expires while retaining the current route", async locale => {
    await i18n.changeLanguage(locale);
    window.location.hash = "#/admin/items";
    const { App } = await import("./App");
    render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>);
    await screen.findByTestId("items-page");
    act(() => notifySessionExpired(401, { message: "Authentication is required." }));
    await screen.findByRole("button", { name: i18n.t("signIn") });
    expect(screen.getByRole("alert").textContent).toContain(i18n.t("sessionExpired"));
    expect(screen.queryByTestId("items-page")).toBeNull();
    expect(window.location.hash).toBe("#/admin/items");
  });

  test("keeps the session for a CSRF error, missing permission, or server failure", async () => {
    window.location.hash = "#/admin/items";
    const { App } = await import("./App");
    render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>);
    await screen.findByTestId("items-page");
    act(() => {
      notifySessionExpired(401, { message: "CSRF validation failed." });
      notifySessionExpired(403, { message: "Required permission is missing." });
      notifySessionExpired(500, { message: "An unexpected error occurred." });
    });
    expect(screen.getByTestId("items-page")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  test("does not interrupt a workspace during connection checks, but blocks it on a confirmed outage", async () => {
    window.location.hash = "#/reports";
    const ticks: Array<() => void> = [];
    const realSetInterval = window.setInterval.bind(window);
    vi.spyOn(window, "setInterval").mockImplementation((callback, timeout) => {
      if (timeout === 30_000 && typeof callback === "function") ticks.push(callback as () => void);
      return realSetInterval(callback, timeout) as unknown as ReturnType<typeof window.setInterval>;
    });
    const normalFetch = vi.mocked(fetch).getMockImplementation()!;
    let settle: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation((input, init) => String(input).includes("/health/live")
      ? new Promise<Response>(resolve => { settle = resolve; }) : normalFetch(input, init));
    const { App } = await import("./App");
    render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>);
    const workspace = await screen.findByTestId("reports-page");
    expect(workspace.getAttribute("data-online")).toBe("true");
    await waitFor(() => expect(settle).toBeTypeOf("function"));
    await act(async () => { settle!(json({ status: "ok" })); });
    act(() => { ticks.forEach(tick => tick()); });
    expect(workspace.getAttribute("data-online")).toBe("true");
    await act(async () => { settle!(json({}, 503)); });
    expect(workspace.getAttribute("data-online")).toBe("false");
    act(() => { ticks.forEach(tick => tick()); });
    expect(workspace.getAttribute("data-online")).toBe("false");
    await act(async () => { settle!(json({ status: "ok" })); });
    expect(workspace.getAttribute("data-online")).toBe("true");
  });
});
