import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "../i18n";
import { WarehouseOperationsPage } from "./warehouse-operations";

const request = {
  id: "10000000-0000-4000-8000-000000000001",
  requestNumber: "Req-2026-0001",
  branch: { id: "branch", code: "B1", nameAr: "فودوزو", nameEn: "Foodoozo" },
  status: "preparing",
  rowVersion: 5,
  items: [],
  statusHistory: [],
  submittedAt: null,
  warehouseAvailableAt: null,
};
const endpoint = `/api/v1/warehouse/requests/${request.id}`;
const line = {
  id: "milk-line", sku: "MILK", nameAr: "حليب", nameEn: "Milk", nameUr: "دودھ", unitCode: "L", quantity: "10",
  defaultSupplierId: "supplier-a",
  suppliers: [
    { id: "supplier-a", code: "A", name: "Mabkhout", lastCost: "11", averageCost: "12.5", lastPurchasedAt: "2026-11-20" },
    { id: "supplier-b", code: "B", name: "Radman", lastCost: "10", averageCost: "11.5", lastPurchasedAt: "2026-11-21" },
  ],
};
const allocationA = { id: "allocation-a", requestItemId: line.id, supplierId: "supplier-a", quantity: "4.25", estimatedUnitCost: "12.5", purchasedQuantity: "0", actualCost: "0" };
const allocationB = { id: "allocation-b", requestItemId: line.id, supplierId: "supplier-b", quantity: "5.75", estimatedUnitCost: "11.5", purchasedQuantity: "0", actualCost: "0" };
const sheets = [
  { id: "sheet-a", number: "Pur-2026-0001", supplierId: "supplier-a", supplierCode: "A", supplierName: "Mabkhout", issuedAt: "2026-11-24T11:00:00Z", allocationIds: [allocationA.id] },
  { id: "sheet-b", number: "Pur-2026-0002", supplierId: "supplier-b", supplierCode: "B", supplierName: "Radman", issuedAt: "2026-11-24T11:00:00Z", allocationIds: [allocationB.id] },
];
const initial = { requestId: request.id, plan: null, lines: [line], allocations: [], sheets: [], purchases: [] };
const issued = { ...initial, plan: { id: "plan", revision: 3, status: "issued", basis: "average" }, allocations: [allocationA, allocationB], sheets };
const allPermissions = ["warehouse.process", "purchase.prepare", "purchase.issue", "purchase.record"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(async () => { await i18n.changeLanguage("en"); });
afterEach(() => { vi.unstubAllGlobals(); });

function mount(permissions = allPermissions) {
  return render(<I18nextProvider i18n={i18n}>
    <WarehouseOperationsPage online onNavigate={vi.fn()} path={`#/warehouse/requests/${request.id}`} permissions={permissions} />
  </I18nextProvider>);
}

describe("Warehouse purchasing", () => {
  test("compares actual costs, saves a partial draft, splits full quantity, and prints an individual supplier sheet", async () => {
    const mutations: Array<{ path: string; payload: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (path, init) => {
      if (path === endpoint) return json(request);
      if (path === `${endpoint}/purchasing`) return json(initial);
      if (path === "/api/v1/auth/csrf") return json({ csrfToken: "warehouse-csrf" });
      expect(new Headers(init.headers).get("x-csrf-token")).toBe("warehouse-csrf");
      const payload = JSON.parse(String(init.body));
      mutations.push({ path, payload });
      if (path === `${endpoint}/purchasing/issue`) return json(issued);
      return json({
        ...initial,
        plan: { id: "plan", revision: mutations.length, status: "draft", basis: "average" },
        allocations: payload.allocations.map((entry: typeof allocationA) => ({ ...allocationA, ...entry })),
      });
    }));
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const user = userEvent.setup();
    mount();

    const supplierTable = await screen.findByRole("table", { name: "Milk" });
    expect(within(supplierTable).getByText("11")).toBeTruthy();
    expect(within(supplierTable).getByText("10")).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: /compare by/i }));
    await user.click(screen.getByRole("option", { name: "Quantity-weighted average" }));
    expect(within(supplierTable).getByText("12.5")).toBeTruthy();
    expect(within(supplierTable).getByText("11.5")).toBeTruthy();

    const inputA = screen.getByRole<HTMLInputElement>("textbox", { name: "Quantity of Milk from Mabkhout" });
    const inputB = screen.getByRole<HTMLInputElement>("textbox", { name: "Quantity of Milk from Radman" });
    expect(inputA.value).toBe("10");
    await user.click(screen.getByRole("button", { name: "Allocate all of Milk to Radman" }));
    expect(inputA.value).toBe("");
    expect(inputB.value).toBe("10");
    await user.clear(inputB);
    await user.type(inputA, "٤٫٢٥");
    const savePlan = screen.getByRole("button", { name: "Save purchase allocation" });
    const issue = screen.getByRole("button", { name: "Issue purchasing sheets" });
    await user.click(savePlan);
    await screen.findByText("Draft");
    expect(issue).toHaveProperty("disabled", true);

    await user.type(inputB, "5.75");
    await user.click(savePlan);
    await waitFor(() => expect(issue).toHaveProperty("disabled", false));
    await user.click(issue);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Issued")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save purchase allocation" })).toBeNull();
    expect(mutations).toEqual([
      { path: `${endpoint}/purchasing/plan`, payload: { expectedRevision: 0, basis: "average", allocations: [{ requestItemId: "milk-line", supplierId: "supplier-a", quantity: "4.25" }] } },
      { path: `${endpoint}/purchasing/plan`, payload: { expectedRevision: 1, basis: "average", allocations: [
        { requestItemId: "milk-line", supplierId: "supplier-a", quantity: "4.25" },
        { requestItemId: "milk-line", supplierId: "supplier-b", quantity: "5.75" },
      ] } },
      { path: `${endpoint}/purchasing/issue`, payload: { expectedRevision: 2 } },
    ]);

    await user.click(screen.getAllByRole("button", { name: "View and print sheet" })[0]);
    const preview = within(await screen.findByRole("dialog"));
    expect(preview.getByText("Mabkhout")).toBeTruthy();
    expect(preview.getByText("4.25")).toBeTruthy();
    expect(preview.queryByText("Radman")).toBeNull();
    expect(preview.queryByText("12.5")).toBeNull();
    expect(document.querySelector("#warehouse-supplier-print")?.textContent).toContain("Pur-2026-0001");
    expect(document.querySelector("#warehouse-supplier-print")?.textContent).not.toContain("Pur-2026-0002");
    await user.click(preview.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledOnce();
  });

  test("records a partial purchase and reuses the original operation ID after an uncertain save", async () => {
    const attempts: Array<{ operationId: string; allocationId: string; quantity: string; unitCost: string; purchasedOn: string; invoiceReference: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (path, init) => {
      if (path === endpoint) return json(request);
      if (path === `${endpoint}/purchasing`) return json(issued);
      if (path === "/api/v1/auth/csrf") return json({ csrfToken: "warehouse-csrf" });
      expect(path).toBe(`${endpoint}/purchasing/receipts`);
      const payload = JSON.parse(String(init.body));
      attempts.push(payload);
      if (attempts.length === 1) return json({ message: "Response unavailable" }, 502);
      return json({
        ...issued,
        allocations: [{ ...allocationA, purchasedQuantity: "1.25", actualCost: "12.5" }, allocationB],
        purchases: [{ id: "purchase-a", ...payload }],
      });
    }));
    const user = userEvent.setup();
    mount(["warehouse.process", "purchase.record"]);
    await user.click(await screen.findByRole("button", { name: "Record purchase of Milk from Mabkhout" }));
    const form = within(await screen.findByRole("dialog"));
    const quantity = form.getByRole("textbox", { name: "Quantity" });
    await user.clear(quantity);
    await user.type(quantity, "5");
    await user.type(form.getByRole("textbox", { name: "Unit cost (SAR)" }), "10");
    expect(form.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    await user.clear(quantity);
    await user.type(quantity, "1.25");
    await user.type(form.getByRole("textbox", { name: "Invoice reference (optional)" }), "INV-100");
    await user.click(form.getByRole("button", { name: "Save" }));
    await form.findByText(/save could not be confirmed/);
    expect(quantity).toHaveProperty("disabled", true);
    await user.click(form.getByRole("button", { name: i18n.t("retry") }));
    expect(await screen.findByRole("table", { name: "Actual purchase history" })).toBeTruthy();
    expect(screen.getByText("INV-100")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: sheets[0].number })).getByText("3")).toBeTruthy();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ allocationId: allocationA.id, quantity: "1.25", unitCost: "10", purchasedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), invoiceReference: "INV-100" });
    expect(attempts[0].operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(attempts[1]).toEqual(attempts[0]);
  });

  test("lets warehouse viewers read comparison and sheets without procurement write permissions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path) => json(path === endpoint ? request : issued)));
    mount(["warehouse.process"]);
    await screen.findByRole("table", { name: sheets[0].number });
    expect(screen.getAllByRole("button", { name: "View and print sheet" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^record purchase/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Issue purchasing sheets" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save purchase allocation" })).toBeNull();
  });
});
