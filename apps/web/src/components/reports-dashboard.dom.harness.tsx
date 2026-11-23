import { I18nextProvider } from "react-i18next";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "../i18n";
import { ReportsDashboardPage } from "./reports-dashboard";

const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const report = (code: string) => ({ data: [{ branch: { id: code, code, nameAr: code }, requestCount: 1, completedCount: 0, pendingCount: 1, returnedCount: 0, rejectedCount: 0, completionRate: 0, totalActiveBaseQuantity: "1", averageEndToEndCompletionMinutes: null }] });
const renderPage = (path = "#/reports/branches") => render(<I18nextProvider i18n={i18n}><ReportsDashboardPage online path={path} canExport /></I18nextProvider>);
beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/reports/filters")
    ? response({ branches: [], statuses: [] }) : response(report("B1"))));
});

describe("Report loading behavior", () => {
  test("waits for Apply instead of reloading after every filter keystroke", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("B1 · B1");
    const initial = vi.mocked(fetch).mock.calls.length;
    await user.type(screen.getByRole("textbox", { name: i18n.t("report.search") }), "potatoes");
    expect(fetch).toHaveBeenCalledTimes(initial);
    await user.click(screen.getByRole("button", { name: i18n.t("apply") }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(initial + 1));
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.at(-1)).toContain("search=potatoes");
    expect(urls.filter(url => url.includes("/reports/filters"))).toHaveLength(1);
  });

  test("changes report tabs without reloading filter options", async () => {
    const view = renderPage();
    await screen.findByText("B1 · B1");
    view.rerender(<I18nextProvider i18n={i18n}><ReportsDashboardPage online path="#/reports/items" canExport /></I18nextProvider>);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/reports/items?"))).toBe(true));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/reports/filters"))).toHaveLength(1);
  });

  test("ignores obsolete responses when a newer filter request finishes first", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("B1 · B1");
    const normal = vi.mocked(fetch).getMockImplementation()!;
    let finishOld: ((value: Response) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input).includes("search=old")) {
        oldSignal = init?.signal ?? undefined;
        return new Promise<Response>(resolve => { finishOld = resolve; });
      }
      if (String(input).includes("search=new")) return Promise.resolve(response(report("NEW")));
      return normal(input, init);
    });
    const search = screen.getByRole("textbox", { name: i18n.t("report.search") });
    await user.type(search, "old");
    await user.click(screen.getByRole("button", { name: i18n.t("apply") }));
    await waitFor(() => expect(finishOld).toBeTruthy());
    fireEvent.change(search, { target: { value: "new" } });
    await user.click(screen.getByRole("button", { name: i18n.t("apply") }));
    await screen.findByText("NEW · NEW");
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { finishOld!(response(report("OLD"))); });
    expect(screen.queryByText("OLD · OLD")).toBeNull();
    expect(screen.getByText("NEW · NEW")).toBeTruthy();
  });
});
