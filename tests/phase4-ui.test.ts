import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveWorkspaceAccess } from "../apps/web/src/workspace-access.ts";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Phase 4 items administration UI contract", () => {
  it("registers the protected Items navigation and production workspace route", () => {
    const app = read("apps/web/src/App.tsx");
    expect(app).toContain("<ItemsPage");
    expect(resolveWorkspaceAccess("#/admin/items", ["admin.manage"]).activeRoute?.view).toBe("items");
    expect(resolveWorkspaceAccess("#/admin/items", ["reports.view"]).path).toBe("#dashboard");
  });

  it("renders item-first setup with supplier selection before restaurant assignment", () => {
    const items = read("apps/web/src/components/item-setup.tsx");
    for (const endpoint of ["/api/v1/admin/item-setup/items", "/api/v1/admin/item-setup/restaurants/", "/supplier", "/units", "/image"]) expect(items).toContain(endpoint);
    expect(items).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(items).toContain('itemImagePreview');
    expect(items).toContain("itemsOffline");
    expect(items).toContain("baseUnitMissing");
  });

  it("includes Phase 4 item strings in Arabic, English, and Urdu without adding Phase 5 modules", () => {
    const dictionary = read("apps/web/src/i18n.ts");
    expect((dictionary.match(/itemsDescription:/g) ?? []).length).toBe(3);
    expect((dictionary.match(/itemConfiguration:/g) ?? []).length).toBe(3);
    expect(dictionary).not.toContain("purchase order workflow");
  });
});
