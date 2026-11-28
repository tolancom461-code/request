import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Step,
  StepButton,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { ItemPurchaseHistory } from "./item-setup-purchase-history";
import { api, mutate } from "./item-setup-api";
import {
  BusyButton,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
} from "./foundation";

type Status = "active" | "inactive";
type Named = {
  id: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  status: Status;
};
type Supplier = {
  id: string;
  supplierCode: string;
  supplierName: string;
  status: Status;
  deletedAt?: string | null;
};
type ItemUnit = {
  id: string;
  unitId: string;
  isBaseUnit: boolean;
  status: Status;
  conversionFactorToBase: string | number;
  unit: Named;
};
type Item = {
  id: string;
  sku: string;
  barcode: string | null;
  categoryId: string;
  nameAr: string;
  nameEn: string | null;
  nameUr: string | null;
  status: Status;
  deletedAt?: string | null;
  imageObjectKey: string | null;
  defaultSupplierId: string | null;
  defaultSupplier: Supplier | null;
  supplierLinks: Array<{ supplierId: string; supplier: Supplier }>;
  category: Named;
  itemUnits: ItemUnit[];
  branchItems: Array<{ branchId: string; status: Status }>;
};
type Options = {
  branches: Named[];
  suppliers: Supplier[];
  categories: Named[];
  units: Named[];
};
type ItemFields = {
  sku: string;
  barcode: string;
  categoryId: string;
  nameAr: string;
  nameEn: string;
  nameUr: string;
  baseUnitId: string;
  status: Status;
};
const baseUnit = (item: Item) =>
  item.itemUnits.find(unit => unit.isBaseUnit && unit.status === "active");
const activeSupplier = (supplier: Supplier) =>
  supplier.status === "active" && !supplier.deletedAt;
const ready = (item: Item) =>
  item.status === "active" &&
  !item.deletedAt &&
  item.category.status === "active" &&
  Boolean(
    baseUnit(item)?.unit.status === "active" &&
      item.defaultSupplier?.status === "active" &&
      !item.defaultSupplier.deletedAt
  );

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "HTTP error";

export function ItemSetupWorkspace({ online }: { online: boolean }) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | null | undefined>();
  const [supplierItemId, setSupplierItemId] = useState("");
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [defaultSupplierId, setDefaultSupplierId] = useState("");
  const [supplierHistoryVersion, setSupplierHistoryVersion] = useState(0);
  const [branchId, setBranchId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expectedIds, setExpectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const name = (value: {
    nameAr: string;
    nameEn?: string | null;
    nameUr?: string | null;
  }) =>
    i18n.language.startsWith("ur")
      ? value.nameUr || value.nameEn || value.nameAr
      : i18n.language.startsWith("en")
        ? value.nameEn || value.nameAr
        : value.nameAr;
  const load = useCallback(async () => {
    if (!online) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextOptions, nextItems] = await Promise.all([
        api<Options>("/api/v1/admin/item-setup/options"),
        api<Item[]>("/api/v1/admin/item-setup/items"),
      ]);
      setOptions(nextOptions);
      setItems(nextItems);
      return nextItems;
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [online]);
  useEffect(() => {
    void load();
  }, [load]);
  const supplierItem = items.find(item => item.id === supplierItemId);
  useEffect(() => {
    setSupplierIds(
      supplierItem?.supplierLinks.map(link => link.supplierId) ?? []
    );
    setDefaultSupplierId(supplierItem?.defaultSupplierId ?? "");
  }, [supplierItem]);
  const supplierOptions = useMemo(() => {
    const byId = new Map(
      options?.suppliers.map(supplier => [supplier.id, supplier])
    );
    for (const link of supplierItem?.supplierLinks ?? [])
      byId.set(link.supplierId, link.supplier);
    return [...byId.values()];
  }, [options, supplierItem]);
  const selectedSuppliers = useMemo(
    () => supplierOptions.filter(supplier => supplierIds.includes(supplier.id)),
    [supplierOptions, supplierIds]
  );
  const defaultOptions = selectedSuppliers.filter(activeSupplier);
  const validDefault = defaultOptions.some(
    supplier => supplier.id === defaultSupplierId
  );
  const expectedSupplierIds =
    supplierItem?.supplierLinks.map(link => link.supplierId) ?? [];
  const expectedDefaultSupplierId = supplierItem?.defaultSupplierId ?? null;
  const supplierDirty =
    (defaultSupplierId || null) !== expectedDefaultSupplierId ||
    supplierIds.length !== expectedSupplierIds.length ||
    supplierIds.some(id => !expectedSupplierIds.includes(id));
  const supplierEditDisabled =
    !online || busy || loading || !supplierItem || Boolean(supplierItem.deletedAt);
  const chooseRestaurant = (id: string) => {
    setBranchId(id);
    const ids = items
      .filter(item =>
        item.branchItems.some(
          entry => entry.branchId === id && entry.status === "active"
        )
      )
      .map(item => item.id);
    setSelectedIds(ids);
    setExpectedIds(ids);
    setSuccess(null);
    setSearch("");
    setCategoryId("");
  };
  const changeStep = (next: number) => {
    setStep(next);
    setSearch("");
    setCategoryId("");
    setSuccess(null);
  };
  const reload = async () => {
    const next = await load();
    if (next && branchId) {
      const ids = next
        .filter(item =>
          item.branchItems.some(
            entry => entry.branchId === branchId && entry.status === "active"
          )
        )
        .map(item => item.id);
      setSelectedIds(ids);
      setExpectedIds(ids);
    }
  };
  const filteredItems = useMemo(
    () =>
      items.filter(
        item =>
          (!categoryId || item.categoryId === categoryId) &&
          [item.sku, item.nameAr, item.nameEn, item.nameUr]
            .join(" ")
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())
      ),
    [items, categoryId, search]
  );
  const restaurantItems = filteredItems.filter(
    item => ready(item) || expectedIds.includes(item.id)
  );
  const toggle = (id: string) =>
    setSelectedIds(current =>
      current.includes(id)
        ? current.filter(entry => entry !== id)
        : [...current, id]
    );
  const selectVisible = (checked: boolean) =>
    setSelectedIds(current =>
      checked
        ? [...new Set([...current, ...restaurantItems.map(item => item.id)])]
        : current.filter(id => !restaurantItems.some(item => item.id === id))
    );
  const dirty =
    [...selectedIds].sort().join(",") !== [...expectedIds].sort().join(",");
  const saveSupplier = async () => {
    if (supplierEditDisabled || !supplierItem || !validDefault || !supplierDirty)
      return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await mutate(
        `/api/v1/admin/item-setup/items/${supplierItem.id}/suppliers`,
        {
          supplierIds,
          defaultSupplierId,
          expectedSupplierIds,
          expectedDefaultSupplierId,
        }
      );
      setSupplierHistoryVersion(version => version + 1);
      await load();
      setSuccess(t("setup.supplierSaved"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const saveRestaurant = async () => {
    if (!online || !branchId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await mutate(`/api/v1/admin/item-setup/restaurants/${branchId}/items`, {
        itemIds: selectedIds,
        expectedItemIds: expectedIds,
      });
      setExpectedIds([...selectedIds]);
      await load();
      setSuccess(t("setup.restaurantSaved"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title={t("setup.title")}
        description={t("setup.description")}
      />
      <SectionCard title={t("setup.masterData")}>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {(
            [
              ["branches", "setup.restaurants"],
              ["suppliers", "suppliers"],
              ["categories", "categories"],
              ["units", "units"],
            ] as const
          ).map(([route, label]) => (
            <Button
              key={route}
              component="a"
              href={`#/admin/${route}`}
              variant="outlined"
            >
              {t(label)}
            </Button>
          ))}
        </Box>
      </SectionCard>
      <Stepper activeStep={step} nonLinear sx={{ my: 3 }} alternativeLabel>
        {[
          "setup.itemDetails",
          "setup.itemSupplier",
          "setup.restaurantItems",
        ].map((label, index) => (
          <Step key={label}>
            <StepButton disabled={busy} onClick={() => changeStep(index)}>
              {t(label)}
            </StepButton>
          </Step>
        ))}
      </Stepper>
      {!online && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t("itemsOffline")}
        </Alert>
      )}
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button disabled={!online || busy} onClick={() => void reload()}>
              {t("retry")}
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}
      {loading && !options ? (
        <LoadingState
          title={t("loadingTitle")}
          message={t("loadingDescription")}
        />
      ) : !options ? (
        <ErrorState title={t("loadFailed")} message={t("itemsLoadFailed")} />
      ) : (
        <>
          {step === 0 && (
            <SectionCard
              title={t("setup.itemDetails")}
              action={
                <Button
                  disabled={!online || busy || loading}
                  onClick={() => setEditing(null)}
                  variant="contained"
                >
                  {t("createItem")}
                </Button>
              }
            >
              <TextField
                fullWidth
                label={t("searchItems")}
                value={search}
                onChange={event => setSearch(event.target.value)}
                sx={{ mb: 2 }}
              />
              {!filteredItems.length ? (
                <EmptyState title={t("emptyTitle")} message={t("itemsEmpty")} />
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("sku")}</TableCell>
                        <TableCell>{t("item")}</TableCell>
                        <TableCell>{t("category")}</TableCell>
                        <TableCell>{t("unit")}</TableCell>
                        <TableCell>{t("setup.defaultSupplier")}</TableCell>
                        <TableCell>{t("status")}</TableCell>
                        <TableCell>{t("actions")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredItems.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>{item.sku}</TableCell>
                          <TableCell>{name(item)}</TableCell>
                          <TableCell>{name(item.category)}</TableCell>
                          <TableCell>
                            {baseUnit(item)
                              ? name(baseUnit(item)!.unit)
                              : t("baseUnitMissing")}
                          </TableCell>
                          <TableCell>
                            {item.defaultSupplier?.supplierName ??
                              t("setup.supplierNeeded")}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={t(item.status)}
                              color={
                                item.status === "active" ? "success" : "default"
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              disabled={!online || busy || loading}
                              onClick={() => setEditing(item)}
                            >
                              {t("manage")}
                            </Button>
                            <Button
                              disabled={!online || busy || loading}
                              onClick={() => {
                                setSupplierItemId(item.id);
                                changeStep(1);
                              }}
                            >
                              {t("setup.linkSupplier")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
              <Box sx={{ mt: 2 }}>
                <Button onClick={() => changeStep(1)}>
                  {t("setup.nextSupplier")}
                </Button>
              </Box>
            </SectionCard>
          )}
          {step === 1 && (
            <SectionCard title={t("setup.itemSupplier")}>
              <Box sx={{ display: "grid", gap: 2, maxWidth: 650 }}>
                <FormControl fullWidth>
                  <InputLabel id="setup-supplier-item">{t("item")}</InputLabel>
                  <Select
                    labelId="setup-supplier-item"
                    label={t("item")}
                    value={supplierItemId}
                    disabled={!online || busy || loading}
                    onChange={event => {
                      setSupplierItemId(event.target.value);
                      setSuccess(null);
                    }}
                  >
                    <MenuItem value="">{t("setup.chooseItem")}</MenuItem>
                    {items.map(item => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.sku} · {name(item)}
                        {item.status === "inactive" ? ` · ${t("inactive")}` : ""}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Autocomplete
                  multiple
                  disableCloseOnSelect
                  openOnFocus
                  options={supplierOptions}
                  value={selectedSuppliers}
                  disabled={supplierEditDisabled}
                  getOptionKey={supplier => supplier.id}
                  getOptionLabel={supplier =>
                    `${supplier.supplierCode} · ${supplier.supplierName}${
                      activeSupplier(supplier) ? "" : ` · ${t("inactive")}`
                    }`
                  }
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  onChange={(_event, suppliers) => {
                    setSupplierIds(suppliers.map(supplier => supplier.id));
                    const activeIds = suppliers
                      .filter(activeSupplier)
                      .map(supplier => supplier.id);
                    if (!activeIds.includes(defaultSupplierId))
                      setDefaultSupplierId(
                        activeIds.length === 1 ? activeIds[0] : ""
                      );
                  }}
                  renderInput={params => (
                    <TextField {...params} label={t("setup.linkedSuppliers")} />
                  )}
                />
                <FormControl fullWidth>
                  <InputLabel id="setup-supplier">
                    {t("setup.defaultSupplier")}
                  </InputLabel>
                  <Select
                    labelId="setup-supplier"
                    label={t("setup.defaultSupplier")}
                    value={validDefault ? defaultSupplierId : ""}
                    disabled={supplierEditDisabled || !defaultOptions.length}
                    onChange={event => setDefaultSupplierId(event.target.value)}
                  >
                    <MenuItem value="">{t("selectSupplier")}</MenuItem>
                    {defaultOptions.map(supplier => (
                      <MenuItem key={supplier.id} value={supplier.id}>
                        {supplier.supplierCode} · {supplier.supplierName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography color="text.secondary" variant="body2">
                  {t("setup.supplierNotice")}
                </Typography>
                <BusyButton
                  busy={busy}
                  disabled={supplierEditDisabled || !validDefault || !supplierDirty}
                  onClick={() => void saveSupplier()}
                  variant="contained"
                >
                  {t("setup.saveSupplier")}
                </BusyButton>
                <Button onClick={() => changeStep(2)}>
                  {t("setup.nextRestaurants")}
                </Button>
              </Box>
            </SectionCard>
          )}
          {step === 1 && supplierItem && (
            <ItemPurchaseHistory
              key={supplierItem.id}
              itemId={supplierItem.id}
              itemLabel={name(supplierItem)}
              online={online}
              version={supplierHistoryVersion}
            />
          )}
          {step === 2 && (
            <SectionCard title={t("setup.restaurantItems")}>
              <Box sx={{ display: "grid", gap: 2 }}>
                <FormControl fullWidth>
                  <InputLabel id="setup-restaurant">
                    {t("setup.restaurant")}
                  </InputLabel>
                  <Select
                    labelId="setup-restaurant"
                    label={t("setup.restaurant")}
                    value={branchId}
                    disabled={!online || busy || loading}
                    onChange={event => chooseRestaurant(event.target.value)}
                  >
                    <MenuItem value="">{t("setup.chooseRestaurant")}</MenuItem>
                    {options.branches.map(branch => (
                      <MenuItem key={branch.id} value={branch.id}>
                        {branch.code} · {name(branch)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography color="text.secondary">
                  {t("setup.restaurantNotice")}
                </Typography>
                {branchId && (
                  <>
                    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                      <TextField
                        label={t("searchItems")}
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                      />
                      <FormControl sx={{ minWidth: 200 }}>
                        <InputLabel id="setup-category">
                          {t("category")}
                        </InputLabel>
                        <Select
                          labelId="setup-category"
                          label={t("category")}
                          value={categoryId}
                          onChange={event => setCategoryId(event.target.value)}
                        >
                          <MenuItem value="">{t("allCategories")}</MenuItem>
                          {options.categories.map(category => (
                            <MenuItem key={category.id} value={category.id}>
                              {name(category)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                    <Typography>
                      {t("setup.selectedCount", { count: selectedIds.length })}
                      {dirty ? ` · ${t("setup.unsaved")}` : ""}
                    </Typography>
                    {!restaurantItems.length ? (
                      <EmptyState
                        title={t("emptyTitle")}
                        message={t("setup.noReadyItems")}
                      />
                    ) : (
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell padding="checkbox">
                                <Checkbox
                                  slotProps={{
                                    input: {
                                      "aria-label": t("setup.selectVisible"),
                                    },
                                  }}
                                  disabled={!online || busy || loading}
                                  checked={restaurantItems.every(item =>
                                    selectedIds.includes(item.id)
                                  )}
                                  indeterminate={
                                    restaurantItems.some(item =>
                                      selectedIds.includes(item.id)
                                    ) &&
                                    !restaurantItems.every(item =>
                                      selectedIds.includes(item.id)
                                    )
                                  }
                                  onChange={event =>
                                    selectVisible(event.target.checked)
                                  }
                                />
                              </TableCell>
                              <TableCell>{t("item")}</TableCell>
                              <TableCell>{t("category")}</TableCell>
                              <TableCell>{t("unit")}</TableCell>
                              <TableCell>{t("setup.defaultSupplier")}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {restaurantItems.map(item => (
                              <TableRow key={item.id}>
                                <TableCell padding="checkbox">
                                  <Checkbox
                                    slotProps={{
                                      input: { "aria-label": name(item) },
                                    }}
                                    disabled={!online || busy || loading}
                                    checked={selectedIds.includes(item.id)}
                                    onChange={() => toggle(item.id)}
                                  />
                                </TableCell>
                                <TableCell>
                                  {name(item)}
                                  <Typography
                                    variant="caption"
                                    sx={{ display: "block" }}
                                  >
                                    {item.sku}
                                  </Typography>
                                  {!ready(item) && (
                                    <Chip
                                      size="small"
                                      label={t("setup.existingItemNotice")}
                                    />
                                  )}
                                </TableCell>
                                <TableCell>{name(item.category)}</TableCell>
                                <TableCell>
                                  {baseUnit(item)
                                    ? name(baseUnit(item)!.unit)
                                    : "—"}
                                </TableCell>
                                <TableCell>
                                  {item.defaultSupplier?.supplierName ??
                                    t("setup.supplierNeeded")}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                    <BusyButton
                      busy={busy}
                      disabled={!online || loading || !dirty}
                      onClick={() => void saveRestaurant()}
                      variant="contained"
                    >
                      {t("setup.saveRestaurant")}
                    </BusyButton>
                  </>
                )}
              </Box>
            </SectionCard>
          )}
          {editing !== undefined && (
            <ItemEditor
              item={editing}
              options={options}
              online={online}
              onClose={() => setEditing(undefined)}
              onSaved={async id => {
                setEditing(undefined);
                await load();
                setSupplierItemId(id);
                setSuccess(t("setup.itemSaved"));
              }}
            />
          )}
        </>
      )}
    </Box>
  );
}

function ItemEditor({
  item,
  options,
  online,
  onClose,
  onSaved,
}: {
  item: Item | null;
  options: Options;
  online: boolean;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<ItemFields>(() => ({
    sku: item?.sku ?? "",
    barcode: item?.barcode ?? "",
    categoryId: item?.categoryId ?? "",
    nameAr: item?.nameAr ?? "",
    nameEn: item?.nameEn ?? "",
    nameUr: item?.nameUr ?? "",
    baseUnitId: item ? (baseUnit(item)?.unitId ?? "") : "",
    status: item?.status ?? "active",
  }));
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof ItemFields, value: string) =>
    setFields(current => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!image) return;
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  useEffect(() => {
    if (!item?.imageObjectKey || image || removeImage) return;
    let cancelled = false;
    void api<{ url: string | null }>(`/api/v1/admin/items/${item.id}/image`)
      .then(result => {
        if (!cancelled) setPreview(result.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item, image, removeImage]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!online) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("data", JSON.stringify({ ...fields, removeImage }));
      if (image) form.append("image", image);
      const result = await mutate<{ id: string }>(
        `/api/v1/admin/item-setup/items${item ? `/${item.id}` : ""}`,
        form,
        item ? "PATCH" : "POST"
      );
      await onSaved(result.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const valid = [
    fields.sku,
    fields.nameAr,
    fields.nameEn,
    fields.nameUr,
    fields.categoryId,
    fields.baseUnitId,
  ].every(value => value.trim());
  return (
    <Dialog fullWidth maxWidth="md" open onClose={busy ? undefined : onClose}>
      <Box component="form" onSubmit={event => void save(event)}>
        <DialogTitle>{t(item ? "manageItem" : "createItem")}</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box
            sx={{
              display: "grid",
              gap: 2,
              pt: 1,
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            }}
          >
            {(
              [
                ["sku", "sku"],
                ["barcode", "barcode"],
                ["nameAr", "nameAr"],
                ["nameEn", "nameEn"],
                ["nameUr", "nameUr"],
              ] as const
            ).map(([key, label]) => (
              <TextField
                key={key}
                label={t(label)}
                value={fields[key]}
                required={key !== "barcode"}
                disabled={!online || busy}
                onChange={event => field(key, event.target.value)}
              />
            ))}
            <FormControl required disabled={!online || busy}>
              <InputLabel id="setup-editor-category">
                {t("category")}
              </InputLabel>
              <Select
                labelId="setup-editor-category"
                label={t("category")}
                value={fields.categoryId}
                onChange={event => field("categoryId", event.target.value)}
              >
                {options.categories.map(category => (
                  <MenuItem key={category.id} value={category.id}>
                    {category.nameAr}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl required disabled={!online || busy}>
              <InputLabel id="setup-editor-unit">{t("unit")}</InputLabel>
              <Select
                labelId="setup-editor-unit"
                label={t("unit")}
                value={fields.baseUnitId}
                onChange={event => field("baseUnitId", event.target.value)}
              >
                {options.units.map(unit => (
                  <MenuItem key={unit.id} value={unit.id}>
                    {unit.nameAr}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl disabled={!online || busy}>
              <InputLabel id="setup-editor-status">{t("status")}</InputLabel>
              <Select
                labelId="setup-editor-status"
                label={t("status")}
                value={fields.status}
                onChange={event => field("status", event.target.value)}
              >
                <MenuItem value="active">{t("active")}</MenuItem>
                <MenuItem value="inactive">{t("inactive")}</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Button
                component="label"
                variant="outlined"
                disabled={!online || busy}
              >
                {t("uploadImage")}
                <input
                  aria-label={t("itemImage")}
                  accept="image/jpeg,image/png,image/webp"
                  type="file"
                  hidden
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (
                      !["image/jpeg", "image/png", "image/webp"].includes(
                        file.type
                      ) ||
                      file.size <= 0 ||
                      file.size > 5 * 1024 * 1024
                    ) {
                      setError(t("imageRules"));
                      event.target.value = "";
                      return;
                    }
                    setImage(file);
                    setRemoveImage(false);
                    setError(null);
                  }}
                />
              </Button>
              {item?.imageObjectKey && !removeImage && (
                <Button
                  color="warning"
                  disabled={!online || busy}
                  onClick={() => {
                    setRemoveImage(true);
                    setImage(null);
                    setPreview(null);
                  }}
                >
                  {t("removeImage")}
                </Button>
              )}
              <Typography variant="caption" sx={{ display: "block" }}>
                {image?.name ?? t("imageRules")}
              </Typography>
              {preview && (
                <Box
                  component="img"
                  alt={t("itemImagePreview")}
                  src={preview}
                  sx={{
                    display: "block",
                    maxHeight: 160,
                    maxWidth: "100%",
                    mt: 1,
                  }}
                />
              )}
            </Box>
          </Box>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 2 }}>
            {t("setup.itemSaveNotice")}
          </Typography>
          {item && (
            <ExtraUnits
              item={item}
              options={options}
              online={online && !busy}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <BusyButton
            busy={busy}
            disabled={!online || !valid}
            type="submit"
            variant="contained"
          >
            {t("setup.saveItem")}
          </BusyButton>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function ExtraUnits({
  item,
  options,
  online,
}: {
  item: Item;
  options: Options;
  online: boolean;
}) {
  const { t } = useTranslation();
  const [units, setUnits] = useState(item.itemUnits);
  const [unitId, setUnitId] = useState("");
  const [factor, setFactor] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await mutate(`/api/v1/admin/items/${item.id}/units`, {
        unitId,
        conversionFactorToBase: factor,
        isBaseUnit: false,
        status: "active",
      });
      setUnits(await api<ItemUnit[]>(`/api/v1/admin/items/${item.id}/units`));
      setUnitId("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box component="details" sx={{ mt: 2 }}>
      <Typography component="summary" sx={{ cursor: "pointer" }}>
        {t("setup.extraUnits")}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 2 }}>
        <FormControl sx={{ minWidth: 180 }}>
          <InputLabel id="setup-extra-unit">{t("unit")}</InputLabel>
          <Select
            labelId="setup-extra-unit"
            label={t("unit")}
            value={unitId}
            onChange={event => setUnitId(event.target.value)}
          >
            {options.units
              .filter(unit => !units.some(entry => entry.unitId === unit.id))
              .map(unit => (
                <MenuItem key={unit.id} value={unit.id}>
                  {unit.nameAr}
                </MenuItem>
              ))}
          </Select>
        </FormControl>
        <TextField
          label={t("conversionFactor")}
          value={factor}
          type="number"
          onChange={event => setFactor(event.target.value)}
        />
        <BusyButton
          busy={busy}
          disabled={!online || !unitId || Number(factor) <= 0}
          onClick={() => void add()}
        >
          {t("add")}
        </BusyButton>
      </Box>
      {units.map(unit => (
        <Typography key={unit.id} variant="body2">
          {unit.unit.nameAr} · {String(unit.conversionFactorToBase)}
          {unit.isBaseUnit ? ` · ${t("baseUnit")}` : ""}
        </Typography>
      ))}
    </Box>
  );
}
