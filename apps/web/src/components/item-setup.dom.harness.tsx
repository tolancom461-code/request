import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "../i18n";
import { ItemSetupWorkspace } from "./item-setup";
import { SESSION_EXPIRED_EVENT } from "../session-events";

const category = {
  id: "category",
  code: "FOOD",
  nameAr: "غذاء",
  nameEn: "Food",
  status: "active",
};
const unit = {
  id: "kg",
  code: "KG",
  nameAr: "كيلو",
  nameEn: "Kilogram",
  status: "active",
};
const supplier = {
  id: "supplier",
  supplierCode: "S1",
  supplierName: "Food supplier",
  status: "active",
};
const alternate = {
  id: "alternate",
  supplierCode: "S2",
  supplierName: "Alternate supplier",
  status: "active",
};
const former = { ...alternate, id: "former", supplierCode: "S3", supplierName: "Former supplier" };
const options = {
  categories: [category],
  units: [unit],
  suppliers: [supplier, alternate],
  branches: [
    {
      id: "foodzo",
      code: "F1",
      nameAr: "فودوزو",
      nameEn: "Foodzo",
      status: "active",
    },
    {
      id: "other",
      code: "F2",
      nameAr: "مطعم آخر",
      nameEn: "Other restaurant",
      status: "active",
    },
  ],
};
function item(id: string, name: string, linked = true) {
  return {
    id,
    sku: id.toUpperCase(),
    nameAr: name,
    nameEn: name,
    nameUr: name,
    categoryId: category.id,
    category,
    status: "active",
    barcode: null,
    imageObjectKey: null,
    defaultSupplierId: linked ? supplier.id : null,
    defaultSupplier: linked ? supplier : null,
    supplierLinks: linked ? [{ supplierId: supplier.id, supplier }] : [],
    itemUnits: [
      {
        id: `${id}-unit`,
        unitId: unit.id,
        isBaseUnit: true,
        status: "active",
        conversionFactorToBase: "1",
        unit,
      },
    ],
    branchItems: [] as Array<{ branchId: string; status: string }>,
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
let records: ReturnType<typeof item>[];
let mutations: Array<{ path: string; init: RequestInit }>;
let openingPurchases: Array<Record<string, string>>;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  records = [
    item("rice", "Rice"),
    item("oil", "Oil"),
    item("salt", "Salt", false),
  ];
  mutations = [];
  openingPurchases = [];
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:item-preview"),
      revokeObjectURL: vi.fn(),
    })
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/auth/csrf")) return json({ csrfToken: "test-csrf" });
      if (path.includes("/purchase-history?")) {
        const query = new URL(path, "https://example.test").searchParams;
        const page = Number(query.get("page"));
        const showPurchase = path.includes("/rice/") &&
          (!query.get("supplierId") || query.get("supplierId") === former.id);
        return json({
          unitCode: "KG",
          openingSuppliers: [supplier, alternate, former].map(entry => ({ id: entry.id, code: entry.supplierCode, name: entry.supplierName })),
          units: [{ id: "rice-unit", code: "KG", conversionFactor: "1" }, { id: "rice-box", code: "BOX", conversionFactor: "10" }],
          suppliers: path.includes("/rice/") ? [
            {
              id: supplier.id,
              code: supplier.supplierCode,
              name: supplier.supplierName,
              lastCost: openingPurchases[0]?.unitCost ?? null,
              averageCost: null,
              lastPurchasedAt: null,
            },
            {
              id: former.id,
              code: former.supplierCode,
              name: former.supplierName,
              lastCost: "11.00",
              averageCost: "10.25",
              lastPurchasedAt: "2026-11-24T00:00:00.000Z",
            },
          ] : [],
          purchases: showPurchase ? [...openingPurchases.map(entry => ({
            ...entry, id: entry.operationId, unitCode: entry.itemUnitId === "rice-unit" ? "KG" : "BOX", source: "opening",
            supplierCode: supplier.supplierCode, supplierName: supplier.supplierName,
          })), {
            id: `purchase-${page}`,
            supplierId: former.id,
            supplierCode: former.supplierCode,
            supplierName: former.supplierName,
            quantity: "2",
            unitCode: "BOX",
            unitCost: "110.00",
            purchasedOn: "2026-11-24",
            invoiceReference: `INVOICE-${page}`,
            source: "warehouse",
          }] : [],
          page,
          pageSize: 20,
          total: showPurchase ? 21 : 0,
        });
      }
      if (init?.method === "POST" || init?.method === "PATCH") {
        mutations.push({ path, init });
        if (path.endsWith("/purchase-history/opening")) {
          const { purchases } = JSON.parse(String(init.body));
          openingPurchases = purchases;
          return json({ saved: purchases.length }, 201);
        } else if (path.endsWith("/suppliers")) {
          const id = path.split("/").at(-2);
          const { supplierIds, defaultSupplierId } = JSON.parse(String(init.body)) as {
            supplierIds: string[];
            defaultSupplierId: string;
          };
          records = records.map(entry =>
            entry.id === id
              ? {
                  ...entry,
                  defaultSupplierId,
                  defaultSupplier: options.suppliers.find(current => current.id === defaultSupplierId)!,
                  supplierLinks: options.suppliers
                    .filter(current => supplierIds.includes(current.id))
                    .map(current => ({ supplierId: current.id, supplier: current })),
                }
              : entry
          );
        } else if (path.includes("/restaurants/")) {
          const restaurantId = path.split("/").at(-2)!;
          const { itemIds } = JSON.parse(String(init.body));
          records = records.map(entry => ({
            ...entry,
            branchItems: [
              ...entry.branchItems.filter(
                link => link.branchId !== restaurantId
              ),
              ...(itemIds.includes(entry.id)
                ? [{ branchId: restaurantId, status: "active" }]
                : []),
            ],
          }));
        } else {
          records.push(item("new-item", "New item", false));
          return json({ id: "new-item" }, 201);
        }
        return json({ success: true });
      }
      if (path.endsWith("/options")) return json(options);
      if (path.endsWith("/items")) return json(records);
      return json({ url: null });
    })
  );
});

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("combobox", { name: new RegExp(`^${label}`) })
  );
  await user.click(await screen.findByRole("option", { name: option }));
}
function renderSetup(online = true) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ItemSetupWorkspace online={online} />
    </I18nextProvider>
  );
}

describe("Restaurant setup interactive workflow", () => {
  test("saves names, category, unit and selected image in one request before supplier assignment", async () => {
    const user = userEvent.setup();
    renderSetup();
    await user.click(
      await screen.findByRole("button", { name: "Create item" })
    );
    const dialog = screen.getByRole("dialog");
    for (const [label, value] of [
      ["Item SKU", "NEW"],
      ["Arabic name", "صنف جديد"],
      ["English name", "New item"],
      ["Urdu name", "نیا آئٹم"],
    ])
      await user.type(within(dialog).getByLabelText(new RegExp(label)), value);
    await choose("Category", "غذاء");
    await choose("Unit", "كيلو");
    const file = new File(["test-image"], "rice.png", { type: "image/png" });
    await user.upload(within(dialog).getByLabelText("Item image"), file);
    await user.click(within(dialog).getByRole("button", { name: "Save item" }));
    await screen.findByText(
      "Item and unit saved. You can now link its suppliers."
    );
    expect(mutations).toHaveLength(1);
    const form = mutations[0].init.body as FormData;
    expect(JSON.parse(String(form.get("data")))).toMatchObject({
      sku: "NEW",
      nameAr: "صنف جديد",
      nameEn: "New item",
      nameUr: "نیا آئٹم",
      categoryId: "category",
      baseUnitId: "kg",
      status: "active",
    });
    expect((form.get("image") as File).name).toBe("rice.png");
    expect(mutations[0].init.headers).toMatchObject({
      "X-CSRF-Token": "test-csrf",
    });
  });

  test("chooses the supplier first, then assigns multiple items to a restaurant with one save and reuses an item in another restaurant", async () => {
    const user = userEvent.setup();
    renderSetup();
    await screen.findByText("Rice");
    await user.click(screen.getByRole("tab", { name: "Item suppliers" }));
    await choose("Item", "SALT · Salt");
    await choose("Linked suppliers", "S1 · Food supplier");
    await user.click(screen.getByRole("option", { name: "S2 · Alternate supplier" }));
    await choose("Default supplier", "S2 · Alternate supplier");
    await user.click(
      screen.getByRole("button", { name: "Save item suppliers" })
    );
    await screen.findByText("Item suppliers saved.");
    expect(mutations[0].path).toBe(
      "/api/v1/admin/item-setup/items/salt/suppliers"
    );
    expect(JSON.parse(String(mutations[0].init.body))).toEqual({
      supplierIds: ["supplier", "alternate"],
      defaultSupplierId: "alternate",
      expectedSupplierIds: [],
      expectedDefaultSupplierId: null,
    });
    await user.click(
      screen.getByRole("button", { name: "Next: restaurant items" })
    );
    await choose("Restaurant", "F1 · Foodzo");
    await user.click(screen.getByRole("checkbox", { name: "Rice" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search SKU, name, or barcode" }),
      "Oil"
    );
    await user.click(screen.getByRole("checkbox", { name: "Oil" }));
    await user.click(
      screen.getByRole("button", { name: "Save restaurant items" })
    );
    await screen.findByText("Restaurant items saved.");
    expect(JSON.parse(String(mutations[1].init.body))).toEqual({
      itemIds: ["rice", "oil"],
      expectedItemIds: [],
    });
    await choose("Restaurant", "F2 · Other restaurant");
    await user.click(screen.getByRole("checkbox", { name: "Rice" }));
    await user.click(
      screen.getByRole("button", { name: "Save restaurant items" })
    );
    await waitFor(() => expect(mutations).toHaveLength(3));
    expect(mutations[2].path).toBe(
      "/api/v1/admin/item-setup/restaurants/other/items"
    );
    expect(
      records.find(entry => entry.id === "rice")?.branchItems
    ).toHaveLength(2);
  });

  test("shows costs per base unit and can filter and page purchases from a former supplier", async () => {
    const user = userEvent.setup();
    renderSetup();
    await screen.findByText("Rice");
    await user.click(screen.getByRole("tab", { name: "Item suppliers" }));
    await choose("Item", "RICE · Rice");
    const comparison = await screen.findByRole("table", { name: "Purchase cost comparison" });
    expect(within(comparison).getByText("11.00")).toBeTruthy();
    expect(within(comparison).getByText("10.25")).toBeTruthy();
    expect(screen.getByText("Cost per base unit (KG)")).toBeTruthy();
    const history = screen.getByRole("table", { name: "Item purchase history" });
    expect(within(history).getByText("110.00")).toBeTruthy();
    expect(within(history).getByText("BOX")).toBeTruthy();
    await choose("Filter history by supplier", "S3 · Former supplier");
    await screen.findByText("INVOICE-1");
    await user.click(screen.getByRole("button", { name: /^Next$/ }));
    await screen.findByText("INVOICE-2");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/item-setup/items/rice/purchase-history?page=2&supplierId=former",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  test("pastes a batch of historical purchases, then refreshes the comparison and marks each opening record", async () => {
    const user = userEvent.setup();
    renderSetup();
    await screen.findByText("Rice");
    await user.click(screen.getByRole("tab", { name: "Item suppliers" }));
    await choose("Item", "RICE · Rice");
    await user.click(await screen.findByRole("button", { name: "Enter opening purchases" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByText("Paste from Excel", { selector: "summary" }));
    const paste = dialog.getByRole("textbox", { name: "Paste from Excel" });
    fireEvent.change(paste, { target: { value: "UNKNOWN\tKG\t2025-11-01\t2\t25" } });
    await user.click(dialog.getByRole("button", { name: "Add rows for review" }));
    expect(dialog.getByRole("alert").textContent).toMatch(/pasted row 1/);
    expect(mutations).toHaveLength(0);
    fireEvent.change(paste, { target: { value: "S1\tKG\t2025-11-01\t٢٫٥\t١١\tOPENING-1\nS3\tBOX\t2025-11-17\t2\t110\tOPENING-2" } });
    await user.click(dialog.getByRole("button", { name: "Add rows for review" }));
    expect(dialog.getByText("Purchase 2")).toBeTruthy();
    await user.click(dialog.getByRole("button", { name: "Save opening purchases" }));
    await screen.findByText("Opening purchases saved.");
    expect(mutations).toHaveLength(1);
    expect(mutations[0].path).toBe("/api/v1/admin/item-setup/items/rice/purchase-history/opening");
    expect(mutations[0].init.headers).toMatchObject({ "X-CSRF-Token": "test-csrf" });
    expect(JSON.parse(String(mutations[0].init.body))).toEqual({ purchases: [
      { operationId: expect.any(String), supplierId: "supplier", itemUnitId: "rice-unit", purchasedOn: "2025-11-01", quantity: "2.5", unitCost: "11", invoiceReference: "OPENING-1" },
      { operationId: expect.any(String), supplierId: "former", itemUnitId: "rice-box", purchasedOn: "2025-11-17", quantity: "2", unitCost: "110", invoiceReference: "OPENING-2" },
    ] });
    const history = await screen.findByRole("table", { name: "Item purchase history" });
    expect(within(history).getAllByText("Opening history")).toHaveLength(2);
    expect(within(history).getByText("Warehouse purchase")).toBeTruthy();
  });

  test("reuses the same opening purchase reference when the save response is uncertain", async () => {
    const user = userEvent.setup();
    renderSetup();
    await screen.findByText("Rice");
    await user.click(screen.getByRole("tab", { name: "Item suppliers" }));
    await choose("Item", "RICE · Rice");
    await user.click(await screen.findByRole("button", { name: "Enter opening purchases" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("combobox", { name: "Supplier" }));
    await user.click(await screen.findByRole("option", { name: "S1 · Food supplier" }));
    await user.type(dialog.getByRole("textbox", { name: "Quantity" }), "1");
    await user.type(dialog.getByRole("textbox", { name: "Unit cost (SAR)" }), "11");
    fireEvent.change(dialog.getByLabelText(/^Purchase date/), { target: { value: "2025-11-01" } });
    const normalFetch = vi.mocked(fetch).getMockImplementation()!;
    let firstPayload: RequestInit["body"];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/purchase-history/opening") && !firstPayload) {
        firstPayload = init?.body;
        return json({ message: "Uncertain save" }, 503);
      }
      return normalFetch(input, init);
    });
    const form = dialog.getByRole("button", { name: "Save opening purchases" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await dialog.findByText(/The save could not be confirmed/);
    expect(mutations).toHaveLength(0);
    await user.click(dialog.getByRole("button", { name: "Try again" }));
    await screen.findByText("Opening purchases saved.");
    expect(mutations[0].init.body).toBe(firstPayload);
  });

  test("disables mutations when the connection is lost", async () => {
    const user = userEvent.setup();
    const view = renderSetup();
    await screen.findByText("Rice");
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ItemSetupWorkspace online={false} />
      </I18nextProvider>
    );
    expect(
      (screen.getByRole("button", { name: "Create item" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    await user.click(screen.getByRole("tab", { name: "Restaurant items" }));
    expect(
      (
        screen.getByRole("combobox", { name: "Restaurant" }) as HTMLElement
      ).getAttribute("aria-disabled")
    ).toBe("true");
    expect(mutations).toHaveLength(0);
  });

  test("requests sign-in without posting the supplier when authentication expires before saving", async () => {
    const user = userEvent.setup();
    renderSetup();
    await screen.findByText("Rice");
    await user.click(screen.getByRole("tab", { name: "Item suppliers" }));
    await choose("Item", "SALT · Salt");
    await choose("Linked suppliers", "S1 · Food supplier");
    const normalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).endsWith("/auth/csrf")
        ? Promise.resolve(json({ message: "Authentication is required." }, 401))
        : normalFetch(input, init)
    );
    const dispatch = vi.spyOn(window, "dispatchEvent");
    await user.click(screen.getByRole("button", { name: "Save item suppliers" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: SESSION_EXPIRED_EVENT })));
    expect(mutations).toHaveLength(0);
  });
});
