import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

describe("Phase 9 reports dashboard UI contract", () => {
  it("TC-P9-UI-01 registers permission-gated reports navigation and protected hash routes", async () => {
    const app = await read("apps/web/src/App.tsx");
    expect(app).toContain('includes("reports.view")');
    expect(app).toContain('includes("reports.export")');
    expect(app).toContain('href="#/reports"');
    expect(app).toContain("isReportsRoute");
    expect(app).toContain("ReportsDashboardPage");
  });

  it("TC-P9-UI-02 binds server-backed dashboard, report surfaces, date/scope/status filters and export", async () => {
    const component = await read("apps/web/src/components/reports-dashboard.tsx");
    for (const marker of ["/api/v1/reports/filters", "/api/v1/reports/${tab}", "/api/v1/reports/export", "from", "to", "branchId", "statuses", "canExport", "window.location.assign"]) expect(component).toContain(marker);
    for (const tab of ["dashboard", "requests", "branches", "items", "suppliers", "status-lifecycle", "approvals", "warehouse"]) expect(component).toContain(tab);
  });

  it("TC-P9-UI-03 exposes online-first loading, empty, error and offline states without local report persistence", async () => {
    const component = await read("apps/web/src/components/reports-dashboard.tsx");
    for (const marker of ["LoadingState", "EmptyState", "ErrorState", "OfflineNotice", 'cache: "no-store"', "report.offline", "reportLoadFailed"]) expect(component).toContain(marker);
    expect(component).not.toContain("localStorage");
    expect(component).not.toContain("indexedDB");
  });

  it("TC-P9-UI-04 provides Arabic, English and Urdu reporting vocabulary", async () => {
    const translations = await read("apps/web/src/i18n.ts");
    expect(translations).toContain("const phase9Translations");
    for (const marker of ["التقارير", "Operational reporting", "عملی رپورٹنگ", "report: {", "exportCsv", "status-lifecycle"]) expect(translations).toContain(marker);
  });
});
