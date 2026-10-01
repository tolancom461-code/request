import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

describe("Phase 6 manager approval UI contract", () => {
  it("registers the permission-gated manager inbox and nested review route", async () => {
    const app = await read("apps/web/src/App.tsx");
    expect(app).toContain('href="#/manager/requisitions"');
    expect(app).toContain("isManagerRoute");
    expect(app).toContain("canReview");
    expect(app).toContain("ManagerApprovalPage");
    expect(app).toContain("managerAccessDenied");
  });

  it("uses the real manager API, CSRF mutation flow, row-version payloads, and server-backed unit choices", async () => {
    const ui = await read("apps/web/src/components/manager-approval.tsx");
    for (const endpoint of ["/manager/requests?", "/manager/requests/${reviewId}", "/items/${line.id}/units", "/exclude", "/approve", "/auth/csrf", "reasonIntent.kind"]) expect(ui).toContain(endpoint);
    expect(ui).toContain("X-CSRF-Token");
    expect(ui).toContain("expectedRowVersion");
    expect(ui).toContain("itemUnitId");
  });

  it("renders representative review workflow states and prevents offline mutation actions", async () => {
    const ui = await read("apps/web/src/components/manager-approval.tsx");
    for (const marker of ["LoadingState", "EmptyState", "ErrorState", "managerStale", "managerOffline", "managerReturn", "managerReject", "managerExcludeLine", "managerApproveNotice", "if (!online)"]) expect(ui).toContain(marker);
  });

  it("contains Phase 6 translations for Arabic, English, and Urdu including warehouse handoff status", async () => {
    const i18n = await read("apps/web/src/i18n.ts");
    for (const key of ["managerInbox", "managerReview", "managerStale", "managerApprove", "managerReturn", "managerReject", "managerOffline", "sent_to_warehouse"]) expect(i18n).toContain(`${key}:`);
    expect((i18n.match(/managerInbox:/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
