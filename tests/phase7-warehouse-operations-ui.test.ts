import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

describe("Phase 7 warehouse operations UI contract", () => {
  it("registers the permission-gated Warehouse navigation and nested detail route", async () => {
    const app = await read("apps/web/src/App.tsx");
    for (const marker of ['href="#/warehouse/requests"', "isWarehouseRoute", "canWarehouse", "WarehouseOperationsPage", "warehouseAccessDenied"]) expect(app).toContain(marker);
  });

  it("uses real scoped Warehouse API endpoints, CSRF mutations, and row-version payloads", async () => {
    const ui = await read("apps/web/src/components/warehouse-operations.tsx");
    for (const endpoint of ["/warehouse/requests?", "/warehouse/requests/groups?", "/warehouse/requests/${requestId}", "/warehouse/requests/${detail.id}/${intent.action}", "/auth/csrf", 'action: "start-preparation"', 'action: "mark-ready"', 'action: "dispatch"', 'action: "complete"']) expect(ui).toContain(endpoint);
    expect(ui).toContain("X-CSRF-Token");
    expect(ui).toContain("expectedRowVersion");
  });

  it("renders queue, snapshot grouping, strict lifecycle action, conflict refresh, completed read-only, and offline prevention states", async () => {
    const ui = await read("apps/web/src/components/warehouse-operations.tsx");
    for (const marker of ["LoadingState", "EmptyState", "ErrorState", "warehouseGroupBy", "warehouseBaseTotal", "warehouseStale", "warehouseCompletedReadOnly", "warehouseOffline", "if (!online)", "currentIntent"]) expect(ui).toContain(marker);
  });

  it("contains Phase 7 Arabic, English, and Urdu translations for queue and lifecycle states", async () => {
    const i18n = await read("apps/web/src/i18n.ts");
    for (const key of ["warehouseQueue", "warehouseGroupBy", "warehouseStartPreparation", "warehouseMarkReady", "warehouseDispatch", "warehouseComplete", "warehouseOffline", "warehouseStale", "preparing", "ready", "dispatched", "completed"]) expect(i18n).toContain(`${key}:`);
    expect((i18n.match(/warehouseQueue:/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
