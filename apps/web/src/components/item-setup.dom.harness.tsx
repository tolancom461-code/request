import { I18nextProvider } from "react-i18next";
import { render, screen, waitFor, within } from "@testing-library/react";
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
const options = {
  categories: [category],
  units: [unit],
  suppliers: [supplier],
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

beforeEach(async () => {
  await i18n.changeLanguage("en");
  records = [
    item("rice", "Rice"),
    item("oil", "Oil"),
    item("salt", "Salt", false),
  ];
  mutations = [];
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
      if (init?.method === "POST" || init?.method === "PATCH") {
        mutations.push({ path, init });
        if (path.endsWith("/supplier")) {
          const id = path.split("/").at(-2);
          records = records.map(entry =>
            entry.id === id
              ? {
                  ...entry,
                  defaultSupplierId: supplier.id,
                  defaultSupplier: supplier,
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
      "Item and unit saved. You can now choose its supplier."
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
    await user.click(screen.getByRole("tab", { name: "Item supplier" }));
    await choose("Item", "SALT · Salt");
    await choose("Supplier", "S1 · Food supplier");
    await user.click(
      screen.getByRole("button", { name: "Save item supplier" })
    );
    await screen.findByText("Item supplier saved.");
    expect(mutations[0].path).toBe(
      "/api/v1/admin/item-setup/items/salt/supplier"
    );
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
    await user.click(screen.getByRole("tab", { name: "Item supplier" }));
    await choose("Item", "SALT · Salt");
    await choose("Supplier", "S1 · Food supplier");
    const normalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).endsWith("/auth/csrf")
        ? Promise.resolve(json({ message: "Authentication is required." }, 401))
        : normalFetch(input, init)
    );
    const dispatch = vi.spyOn(window, "dispatchEvent");
    await user.click(screen.getByRole("button", { name: "Save item supplier" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: SESSION_EXPIRED_EVENT })));
    expect(mutations).toHaveLength(0);
  });
});
