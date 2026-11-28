import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, TextField, Typography,
} from "@mui/material";
import { BusyButton } from "./foundation";
import { ItemSetupApiError, mutate } from "./item-setup-api";

export type OpeningPurchaseSupplier = { id: string; code: string; name: string };
export type OpeningPurchaseUnit = { id: string; code: string; conversionFactor: string };

type OpeningPurchase = {
  operationId: string;
  supplierId: string;
  itemUnitId: string;
  purchasedOn: string;
  quantity: string;
  unitCost: string;
  invoiceReference: string;
};

const maxRows = 200;
const maxInvoiceLength = 160;

function newRow(defaultSupplier: string, defaultUnit: string): OpeningPurchase {
  return {
    operationId: crypto.randomUUID(), supplierId: defaultSupplier, itemUnitId: defaultUnit,
    purchasedOn: "", quantity: "", unitCost: "", invoiceReference: "",
  };
}

function decimal(value: string) {
  return value.trim()
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace("٫", ".")
    .replace(/^\./, "0.")
    .replace(/\.$/, "");
}

function isDecimal(value: string) {
  return /^\d{1,12}(\.\d{1,6})?$/.test(value);
}

function riyadhDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isPurchaseDate(value: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1000-01-01" || value > today) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

export function OpeningPurchasesDialog({ itemId, itemLabel, online, suppliers, units, baseUnitCode, onClose, onSaved }: {
  itemId: string;
  itemLabel: string;
  online: boolean;
  suppliers: OpeningPurchaseSupplier[];
  units: OpeningPurchaseUnit[];
  baseUnitCode: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const defaultSupplier = suppliers.length === 1 ? suppliers[0].id : "";
  const defaultUnit = units.find(unit => unit.code === baseUnitCode)?.id ?? (units.length === 1 ? units[0].id : "");
  const [rows, setRows] = useState(() => [newRow(defaultSupplier, defaultUnit)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<OpeningPurchase[] | null>(null);
  const [paste, setPaste] = useState("");
  const saving = useRef(false);
  const disabled = busy || !online || Boolean(uncertain);
  const today = riyadhDate();

  function changeRow(row: OpeningPurchase, field: keyof Omit<OpeningPurchase, "operationId">, value: string) {
    setRows(current => current.map(entry => entry.operationId === row.operationId ? { ...entry, [field]: value } : entry));
    setError(null);
  }

  function pasteRows() {
    const lines = paste.trim().split(/\r?\n/).filter(line => line.trim());
    const filled = rows.filter(row => row.quantity || row.unitCost || row.purchasedOn || row.invoiceReference);
    if (filled.length + lines.length > maxRows) {
      setError(t("setup.openingLimit", { count: maxRows }));
      return;
    }
    const suppliersByCode = new Map(suppliers.map(supplier => [supplier.code.toLowerCase(), supplier]));
    const unitsByCode = new Map(units.map(unit => [unit.code.toLowerCase(), unit]));
    const incoming: OpeningPurchase[] = [];
    for (const [index, line] of lines.entries()) {
      const [supplierCode, unitCode, purchasedOn, quantity, unitCost, invoiceReference = "", ...extra] = line.split("\t").map(value => value.trim());
      const supplier = suppliersByCode.get(supplierCode.toLowerCase());
      const unit = unitsByCode.get(unitCode?.toLowerCase() ?? "");
      if (extra.length || !supplier || !unit || !purchasedOn || !quantity || !unitCost) {
        setError(t("setup.openingPasteInvalid", { row: index + 1 }));
        return;
      }
      incoming.push({ ...newRow(supplier.id, unit.id), purchasedOn, quantity, unitCost, invoiceReference });
    }
    setRows([...filled, ...incoming]);
    setPaste("");
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || !online) return;
    const purchases = uncertain ?? rows.map(row => ({
      ...row, quantity: decimal(row.quantity), unitCost: decimal(row.unitCost), invoiceReference: row.invoiceReference.trim(),
    }));
    const invalid = purchases.findIndex(row =>
      !suppliers.some(supplier => supplier.id === row.supplierId) || !units.some(unit => unit.id === row.itemUnitId)
      || !isDecimal(row.quantity) || !/[1-9]/.test(row.quantity) || !isDecimal(row.unitCost)
      || !isPurchaseDate(row.purchasedOn, today) || row.invoiceReference.length > maxInvoiceLength
    );
    if (!uncertain && invalid >= 0) {
      setError(t("setup.openingInvalid", { row: invalid + 1 }));
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await mutate<{ saved: number }>(`/api/v1/admin/item-setup/items/${itemId}/purchase-history/opening`, { purchases });
      onSaved();
    } catch (caught) {
      if (!(caught instanceof ItemSetupApiError) || caught.status >= 500) {
        setUncertain(purchases);
        setError(t("setup.openingUncertain"));
      } else {
        setError(t("setup.openingFailed"));
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={() => { if (!saving.current) onClose(); }} maxWidth="md" fullWidth aria-labelledby="opening-purchases-title">
      <Box component="form" onSubmit={save} noValidate>
        <DialogTitle id="opening-purchases-title">{t("setup.openingPurchases")} · <bdi>{itemLabel}</bdi></DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gap: 2 }}>
            <Typography color="text.secondary" variant="body2">{t("setup.openingInstructions")}</Typography>
            {error && <Alert severity="error">{error}</Alert>}
            {!online && <Alert severity="warning">{t("itemsOffline")}</Alert>}
            <Box component="details" sx={{ "& > summary": { cursor: "pointer", color: "primary.main" } }}>
              <Box component="summary">{t("setup.openingPaste")}</Box>
              <Box sx={{ mt: 1, display: "grid", gap: 1 }}>
                <TextField
                  disabled={disabled} label={t("setup.openingPaste")} helperText={t("setup.openingPasteHelp")}
                  multiline minRows={3} value={paste} onChange={event => setPaste(event.target.value)}
                />
                <Button sx={{ justifySelf: "start" }} disabled={disabled || !paste.trim()} onClick={pasteRows}>
                  {t("setup.openingPasteAdd")}
                </Button>
              </Box>
            </Box>
            {rows.map((row, index) => (
              <Paper key={row.operationId} component="fieldset" variant="outlined" sx={{ m: 0, p: 1.5, minWidth: 0, display: "grid", gap: 1.5 }}>
                <Typography component="legend" color="text.secondary" variant="body2">{t("setup.openingRow", { row: index + 1 })}</Typography>
                <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(3, minmax(0, 1fr))" } }}>
                  <TextField
                    disabled={disabled} size="small" select required label={t("supplier")}
                    value={row.supplierId} onChange={event => changeRow(row, "supplierId", event.target.value)}
                  >
                    {suppliers.map(supplier => <MenuItem key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</MenuItem>)}
                  </TextField>
                  <TextField
                    disabled={disabled} size="small" select required label={t("unit")}
                    value={row.itemUnitId} onChange={event => changeRow(row, "itemUnitId", event.target.value)}
                  >
                    {units.map(unit => <MenuItem key={unit.id} value={unit.id}>{unit.code}</MenuItem>)}
                  </TextField>
                  <TextField
                    disabled={disabled} size="small" required type="date" label={t("setup.purchaseDate")}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
                    value={row.purchasedOn} onChange={event => changeRow(row, "purchasedOn", event.target.value)}
                  />
                  <TextField
                    disabled={disabled} size="small" required label={t("quantity")}
                    slotProps={{ htmlInput: { inputMode: "decimal", dir: "ltr" } }}
                    value={row.quantity} onChange={event => changeRow(row, "quantity", event.target.value)}
                  />
                  <TextField
                    disabled={disabled} size="small" required label={t("setup.openingUnitCost")}
                    slotProps={{ htmlInput: { inputMode: "decimal", dir: "ltr" } }}
                    value={row.unitCost} onChange={event => changeRow(row, "unitCost", event.target.value)}
                  />
                  <TextField
                    disabled={disabled} size="small" label={t("setup.invoiceReference")}
                    slotProps={{ htmlInput: { maxLength: maxInvoiceLength } }}
                    value={row.invoiceReference} onChange={event => changeRow(row, "invoiceReference", event.target.value)}
                  />
                </Box>
                {rows.length > 1 && (
                  <Button color="error" disabled={disabled} onClick={() => setRows(current => current.filter(entry => entry.operationId !== row.operationId))} sx={{ justifySelf: "start" }}>
                    {t("setup.openingRemoveRow")}
                  </Button>
                )}
              </Paper>
            ))}
            <Button
              disabled={disabled || rows.length >= maxRows}
              onClick={() => setRows(current => {
                const previous = current.at(-1);
                return [...current, newRow(previous?.supplierId ?? defaultSupplier, previous?.itemUnitId ?? defaultUnit)];
              })}
              sx={{ justifySelf: "start" }}
            >
              {t("setup.openingAddRow")}
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={onClose}>{t("cancel")}</Button>
          <BusyButton busy={busy} disabled={!online || rows.length === 0} type="submit" variant="contained">{uncertain ? t("retry") : t("setup.openingSave")}</BusyButton>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
