import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Phase 4 items administration UI contract", () => {
  it("registers the protected Items navigation and production workspace route", () => {
    const app = read("apps/web/src/App.tsx");
    expect(app).toContain('href="#/admin/items"');
    expect(app).toContain('path === "#/admin/items" ? <ItemsPage');
    expect(app).toContain('user.permissions?.includes("admin.manage")');
  });

  it("renders real items, units, branch setup, supplier, image and state endpoints", () => {
    const items = read("apps/web/src/components/items.tsx");
    for (const endpoint of ["/api/v1/admin/items", "/units", "/branches", "/api/v1/admin/branch-items/", "/suppliers", "/image"]) expect(items).toContain(endpoint);
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
