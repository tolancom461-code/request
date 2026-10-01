import { I18nextProvider } from "react-i18next";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "../i18n";
import { RequisitionPage } from "./requisition";

const branch = { id: "branch-dom", code: "BR-DOM", nameAr: "فرع الاختبار", nameEn: "DOM Branch" };
const initialRequest = {
  id: "request-dom", requestNumber: "DOM-REQ-001", branch, status: "draft" as const, rowVersion: 7, submittedAt: null,
  items: [{ id: "line-dom", branchItemId: "branch-item-dom", itemId: "item-dom", item: { nameAr: "أرز", nameEn: "Rice", nameUr: "چاول" }, sku: "SKU-DOM", itemUnitId: "unit-piece", unit: { code: "PCS", nameAr: "قطعة", nameEn: "Piece" }, requestedQuantity: "1", lineStatus: "active" as const, addedAfterFirstSubmission: false }],
};
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status }); }

describe("P-FR-001 rendered Cart Edit harness", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes("/api/v1/requisition/branches") && !path.includes("/categories")) return json([branch]);
      if (path.includes("/api/v1/requisition/branches/branch-dom/categories")) return json([]);
      if (path.includes("/api/v1/auth/csrf")) return json({ csrfToken: "csrf-dom-cart" });
      if (path.endsWith("/api/v1/requisitions") && init?.method === "POST") return json(initialRequest);
      if (path.includes("/api/v1/requisition/branch-items/branch-item-dom/units")) return json([{ id: "unit-piece", code: "PCS", nameAr: "قطعة", nameEn: "Piece", isBaseUnit: true }, { id: "unit-box", code: "BOX", nameAr: "صندوق", nameEn: "Box", isBaseUnit: false }]);
      if (path.includes("/api/v1/requisitions/request-dom/items/line-dom") && init?.method === "PATCH") return json({ ...initialRequest, rowVersion: 8, items: [{ ...initialRequest.items[0], itemUnitId: "unit-box", unit: { code: "BOX", nameAr: "صندوق", nameEn: "Box" }, requestedQuantity: "2" }] });
      return json({ data: [], total: 0, page: 1, pageSize: 30 });
    }));
  });

  test("edits a draft cart line through the real CSRF-protected PATCH contract", async () => {
    const user = userEvent.setup();
    render(<I18nextProvider i18n={i18n}><RequisitionPage online /></I18nextProvider>);
    await user.click(await screen.findByLabelText("Branch"));
    await user.click(await screen.findByRole("option", { name: /BR-DOM.*DOM Branch/ }));
    await user.click(await screen.findByRole("button", { name: "Start draft" }));
    await user.click(await screen.findByRole("button", { name: /^Cart/ }));
    await user.click(await screen.findByRole("button", { name: /Edit Rice/ }));
    const quantity = await screen.findByRole("spinbutton", { name: "Quantity" });
    await user.clear(quantity); await user.type(quantity, "2");
    await user.click(screen.getByRole("combobox", { name: "Unit" }));
    await user.click(await screen.findByRole("option", { name: /BOX.*Box/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patch = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([path, init]) => String(path).includes("/api/v1/requisitions/request-dom/items/line-dom") && init?.method === "PATCH");
      expect(patch).toBeTruthy();
      expect((patch?.[1] as RequestInit).headers).toMatchObject({ "X-CSRF-Token": "csrf-dom-cart" });
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ branchItemId: "branch-item-dom", itemUnitId: "unit-box", requestedQuantity: "2", expectedRowVersion: 7 });
    });
    expect(await screen.findByText("Box")).toBeTruthy();
  });

  test("disables cart mutation actions when the client is offline", async () => {
    render(<I18nextProvider i18n={i18n}><RequisitionPage online={false} /></I18nextProvider>);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start draft" })).toHaveProperty("disabled", true);
  });
});
