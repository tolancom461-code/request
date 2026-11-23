import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceAccess } from "../apps/web/src/workspace-access.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

describe("Phase 3 administration UI contracts", () => {
  it("exposes permission-gated navigation for all six administrative surfaces", async () => {
    const app = await read("apps/web/src/App.tsx");
    expect(app).toContain("AdministrationWorkspace");
    const links = resolveWorkspaceAccess("", ["admin.manage"]).allowedRoutes.map(route => route.path);
    expect(links).toEqual(expect.arrayContaining(["#/admin/branches", "#/admin/suppliers", "#/admin/units", "#/admin/categories", "#/admin/users", "#/admin/roles"]));
    expect(resolveWorkspaceAccess("", ["reports.view"]).allowedRoutes.some(route => route.administration)).toBe(false);
  });

  it("uses real protected admin endpoints and represents loading, error, empty, confirmation, and offline states", async () => {
    const admin = await read("apps/web/src/components/admin.tsx");
    for (const endpoint of ["/api/v1/admin/${spec.key}", "/api/v1/admin/users", "/api/v1/admin/roles", "/api/v1/admin/permissions"]) {
      expect(admin).toContain(endpoint);
    }
    for (const state of ["LoadingState", "ErrorState", "EmptyState", "adminOffline", "confirmDeactivate", "BusyButton"]) {
      expect(admin).toContain(state);
    }
  });

  it("contains complete Arabic, English, and Urdu labels for Phase 3 navigation and role assignment", async () => {
    const i18n = await read("apps/web/src/i18n.ts");
    for (const key of ["administration", "branches", "suppliers", "units", "categories", "users", "rolesPermissions", "branchScopes", "assignedUsersColumn"]) {
      expect((i18n.match(new RegExp(`\\b${key}:`, "g")) ?? []).length).toBeGreaterThanOrEqual(3);
    }
  });
});
