import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

describe("Phase 5 requisition UI contract", () => {
  it("registers the protected requisition route and navigation entry", async () => {
    const app = await read("apps/web/src/App.tsx");
    expect(app).toContain('href="#/requisitions"');
    expect(app).toContain("isRequisitionRoute");
    expect(app).toContain("RequisitionPage");
  });

  it("uses the real server-backed catalog, draft, line, submit and resubmit endpoints", async () => {
    const ui = await read("apps/web/src/components/requisition.tsx");
    for (const endpoint of [
      "/requisition/branches",
      "/requisition/branches/${branchId}/categories",
      "/requisitions",
      "/items",
      '"resubmit"',
      '"submit"',
      "/requisitions?page",
    ]) expect(ui).toContain(endpoint);
    expect(ui).toContain("X-CSRF-Token");
    expect(ui).toContain('t("chooseQuantityUnit")');
    expect(ui).toContain("Cart");
  });

  it("exposes an explicit cart edit flow with the existing protected PATCH contract", async () => {
    const ui = await read("apps/web/src/components/requisition.tsx");
    expect(ui).toContain("CartLineEditDialog");
    expect(ui).toContain('"PATCH"');
    expect(ui).toContain("expectedRowVersion: request.rowVersion");
    expect(ui).toContain("branchItemId: editingLine.branchItemId");
    expect(ui).toContain('t("editRecord"');
    expect(ui).toContain("disabled={busy || !online}");
  });

  it("contains Phase 5 user-facing translations in Arabic, English and Urdu", async () => {
    const i18n = await read("apps/web/src/i18n.ts");
    for (const key of ["requisitions", "draftReady", "chooseQuantityUnit", "submit", "myRequests"]) {
      expect(i18n).toContain(`${key}:`);
    }
    expect((i18n.match(/chooseQuantityUnit:/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
