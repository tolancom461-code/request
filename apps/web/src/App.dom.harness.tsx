import { I18nextProvider } from "react-i18next";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "./i18n";

vi.mock("./components/admin", () => ({ AdministrationWorkspace: () => <div data-testid="admin-workspace">Admin workspace</div> }));
vi.mock("./components/items", () => ({ ItemsPage: () => <div data-testid="items-page">Items</div> }));
vi.mock("./components/requisition", () => ({ RequisitionPage: () => <div data-testid="requisition-page">Requisitions</div> }));
vi.mock("./components/manager-approval", () => ({ ManagerApprovalPage: () => <div data-testid="manager-page">Manager review</div> }));
vi.mock("./components/warehouse-operations", () => ({ WarehouseOperationsPage: () => <div data-testid="warehouse-page">Warehouse queue</div> }));
vi.mock("./components/reports-dashboard", () => ({ ReportsDashboardPage: () => <div data-testid="reports-page">Reports dashboard</div> }));

const permissions = ["admin.manage", "request.submit", "request.review", "warehouse.process", "reports.view", "reports.export"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
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
});
