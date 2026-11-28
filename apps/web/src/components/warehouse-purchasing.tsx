import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import { BusyButton, SectionCard } from "./foundation";
import "./warehouse-purchasing.css";

type Basis = "last" | "average";
type Supplier = { id: string; code: string; name: string; lastCost: string | null; averageCost: string | null; lastPurchasedAt: string | null };
type Line = { id: string; sku: string; nameAr: string; nameEn: string | null; nameUr: string | null; unitCode: string; quantity: string; defaultSupplierId: string | null; suppliers: Supplier[] };
type Allocation = { id: string; requestItemId: string; supplierId: string; quantity: string; estimatedUnitCost: string | null; purchasedQuantity: string; actualCost: string };
type Sheet = { id: string; number: string; supplierId: string; supplierCode: string; supplierName: string; issuedAt: string; allocationIds: string[] };
type Purchase = { id: string; allocationId: string; quantity: string; unitCost: string; purchasedOn: string; invoiceReference: string | null };
type PurchaseView = {
  requestId: string;
  plan: { id: string; revision: number; status: "draft" | "issued"; basis: Basis } | null;
  lines: Line[];
  allocations: Allocation[];
  sheets: Sheet[];
  purchases: Purchase[];
};
type Quantities = Record<string, Record<string, string>>;
type ReceiptFields = { quantity: string; unitCost: string; purchasedOn: string; invoiceReference: string };
type Receipt = ReceiptFields & {
  allocation: Allocation;
  line: Line;
  supplier: string;
  operationId: string;
  uncertain: boolean;
};

const maxInvoiceLength = 160;
const quantityFactor = 1_000_000n;

function decimalInput(value: string) {
  const normalized = value.trim()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace("٫", ".").replace(/^\./, "0.");
  const match = /^(\d{1,12})(?:\.(\d{0,6}))?$/.exec(normalized);
  return match ? BigInt(match[1]) * quantityFactor + BigInt((match[2] ?? "").padEnd(6, "0")) : null;
}

function formatQuantity(value: bigint) {
  const fraction = (value % quantityFactor).toString().padStart(6, "0").replace(/0+$/, "");
  return `${value / quantityFactor}${fraction ? `.${fraction}` : ""}`;
}

function initialQuantities(view: PurchaseView): Quantities {
  const byLine: Quantities = {};
  for (const line of view.lines) {
    byLine[line.id] = {};
    if (!view.plan && line.defaultSupplierId && line.suppliers.some((supplier) => supplier.id === line.defaultSupplierId)) {
      byLine[line.id][line.defaultSupplierId] = line.quantity;
    }
  }
  for (const allocation of view.allocations) {
    if (byLine[allocation.requestItemId]) byLine[allocation.requestItemId][allocation.supplierId] = allocation.quantity;
  }
  return byLine;
}

function lineAllocations(line: Line, quantities: Quantities) {
  return Object.entries(quantities[line.id] ?? {}).map(([supplierId, value]) => ({
    requestItemId: line.id,
    supplierId,
    quantity: value.trim() ? decimalInput(value) : 0n,
    available: line.suppliers.some((supplier) => supplier.id === supplierId),
  }));
}

function allocatedTotal(allocations: ReturnType<typeof lineAllocations>) {
  return allocations.reduce((sum, row) => sum + (row.quantity ?? 0n), 0n);
}

function remainingQuantity(allocation: Allocation) {
  return decimalInput(allocation.quantity)! - decimalInput(allocation.purchasedQuantity)!;
}

function itemName(line: Line, language: string) {
  if (language.startsWith("ur")) return line.nameUr || line.nameEn || line.nameAr;
  if (language.startsWith("en")) return line.nameEn || line.nameAr;
  return line.nameAr;
}

function dateLabel(date: string | null, language: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "Asia/Riyadh" })
    .format(new Date(date.length === 10 ? `${date}T12:00:00Z` : date));
}

function purchaseToday() {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Riyadh" }).format(new Date());
}

function Money({ amount }: { amount: string | null }) {
  const { t } = useTranslation();
  return amount === null ? t("purchasing.noHistory") : <><bdi dir="ltr">{amount}</bdi> {t("purchasing.currency")}</>;
}

function SupplierSheetDocument({ sheet, requestNumber, rows }: { sheet: Sheet; requestNumber: string; rows: Array<{ line: Line; allocation: Allocation }> }) {
  const { i18n, t } = useTranslation();
  return <article className="warehouse-supplier-document" aria-label={t("purchasing.sheet")}>
    <h2>{t("purchasing.sheet")} · <bdi>{sheet.number}</bdi></h2>
    <dl>
      <dt>{t("supplier")}</dt><dd><bdi>{sheet.supplierCode}</bdi> · <bdi>{sheet.supplierName}</bdi></dd>
      <dt>{t("requestNumber")}</dt><dd><bdi>{requestNumber}</bdi></dd>
      <dt>{t("purchasing.issuedAt")}</dt><dd>{dateLabel(sheet.issuedAt, i18n.language)}</dd>
    </dl>
    <table>
      <thead><tr><th scope="col">{t("sku")}</th><th scope="col">{t("item")}</th><th scope="col">{t("unit")}</th><th scope="col">{t("quantity")}</th></tr></thead>
      <tbody>{rows.map(({ allocation, line }) => <tr key={allocation.id}>
        <td><bdi>{line.sku}</bdi></td><td>{itemName(line, i18n.language)}</td><td><bdi>{line.unitCode}</bdi></td><td><bdi>{allocation.quantity}</bdi></td>
      </tr>)}</tbody>
    </table>
  </article>;
}

export function WarehousePurchasing({ requestId, requestNumber, permissions, api, mutate }: {
  requestId: string;
  requestNumber: string;
  permissions: readonly string[];
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  mutate: <T>(path: string, body: unknown) => Promise<T>;
}) {
  const { i18n, t } = useTranslation();
  const endpoint = `/api/v1/warehouse/requests/${requestId}/purchasing`;
  const canPrepare = permissions.includes("purchase.prepare");
  const canIssue = permissions.includes("purchase.issue");
  const canRecord = permissions.includes("purchase.record");
  const [view, setView] = useState<PurchaseView | null>(null);
  const [basis, setBasis] = useState<Basis>("last");
  const [quantities, setQuantities] = useState<Quantities>({});
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"plan" | "issue" | "receipt" | null>(null);
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Sheet | null>(null);

  function applyView(updated: PurchaseView) {
    setView(updated);
    setBasis(updated.plan?.basis ?? "last");
    setQuantities(initialQuantities(updated));
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api<PurchaseView>(endpoint, { signal: controller.signal }).then((updated) => {
      if (!controller.signal.aborted) applyView(updated);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError({ message: caught instanceof Error ? caught.message : "", conflict: false });
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [api, endpoint, reload]);

  const lines = view?.lines ?? [];
  const issued = view?.plan?.status === "issued";
  const editable = canPrepare && !issued;
  const rowsByLine = new Map(lines.map((line) => [line.id, lineAllocations(line, quantities)]));
  const totalsByLine = new Map([...rowsByLine].map(([id, rows]) => [id, allocatedTotal(rows)]));
  const allocations = [...rowsByLine.values()].flat();
  const validAllocation = lines.length > 0 && lines.every((line) => totalsByLine.get(line.id)! <= decimalInput(line.quantity)!) &&
    allocations.every((row) => row.quantity !== null && (row.available || row.quantity === 0n));
  const balanced = validAllocation && lines.every((line) => totalsByLine.get(line.id) === decimalInput(line.quantity));
  const allocated = allocations.flatMap(({ requestItemId, supplierId, quantity }) => quantity && quantity > 0n
    ? [{ requestItemId, supplierId, quantity: formatQuantity(quantity) }] : []);
  const dirty = editable && (view?.plan?.basis !== basis || view?.allocations.length !== allocated.length ||
    allocated.some((row) => !view?.allocations.some((saved) => saved.requestItemId === row.requestItemId &&
      saved.supplierId === row.supplierId && decimalInput(saved.quantity) === decimalInput(row.quantity))));
  const locked = Boolean(pending) || loading || Boolean(error?.conflict);

  async function submitPlan(action: "plan" | "issue") {
    setPending(action);
    setError(null);
    try {
      const expectedRevision = view?.plan?.revision ?? 0;
      applyView(await mutate<PurchaseView>(`${endpoint}/${action}`, action === "plan"
        ? { expectedRevision, basis, allocations: allocated }
        : { expectedRevision }));
      setIssueOpen(false);
    } catch (caught) {
      const status = (caught as { status?: number })?.status;
      setError({ message: caught instanceof Error ? caught.message : "", conflict: status === 409 });
      setIssueOpen(false);
    } finally {
      setPending(null);
    }
  }

  function openReceipt(allocation: Allocation, line: Line, supplier: string) {
    setReceiptError(null);
    setReceipt({ allocation, line, supplier, operationId: crypto.randomUUID(), uncertain: false,
      quantity: formatQuantity(remainingQuantity(allocation)), unitCost: "", purchasedOn: purchaseToday(), invoiceReference: "" });
  }

  const receiptQuantity = receipt && decimalInput(receipt.quantity);
  const receiptCost = receipt && decimalInput(receipt.unitCost);
  const receiptValid = receipt && receiptQuantity !== null && receiptQuantity > 0n &&
    receiptQuantity <= remainingQuantity(receipt.allocation) && receiptCost !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(receipt.purchasedOn) && receipt.purchasedOn <= purchaseToday();

  async function submitReceipt() {
    if (!receiptValid || !receipt || receiptQuantity === null || receiptCost === null) return;
    setPending("receipt");
    setReceiptError(null);
    try {
      applyView(await mutate<PurchaseView>(`${endpoint}/receipts`, {
        operationId: receipt.operationId,
        allocationId: receipt.allocation.id,
        quantity: formatQuantity(receiptQuantity),
        unitCost: formatQuantity(receiptCost),
        purchasedOn: receipt.purchasedOn,
        invoiceReference: receipt.invoiceReference.trim() || undefined,
      }));
      setReceipt(null);
    } catch (caught) {
      const status = (caught as { status?: number })?.status;
      if (status === undefined || status >= 500) {
        setReceipt({ ...receipt, uncertain: true });
        setReceiptError(t("purchasing.receiptUncertain"));
      } else if (status === 409) {
        setReceipt(null);
        setError({ message: caught instanceof Error ? caught.message : "", conflict: true });
      } else {
        setReceiptError(caught instanceof Error ? caught.message : t("purchasing.saveFailed"));
      }
    } finally {
      setPending(null);
    }
  }

  function changeReceipt(field: keyof ReceiptFields, value: string) {
    setReceipt((current) => current && { ...current, [field]: value });
  }

  function sheetRows(sheet: Sheet) {
    return sheet.allocationIds.flatMap((id) => {
      const allocation = view?.allocations.find((row) => row.id === id);
      const line = allocation && lines.find((row) => row.id === allocation.requestItemId);
      return allocation && line ? [{ allocation, line }] : [];
    });
  }

  return <SectionCard title={t("purchasing.title")} action={view?.plan && <Chip color={issued ? "success" : "default"} label={t(`purchasing.${view.plan.status}`)} size="small" />}>
    <Stack spacing={2}>
      {loading && <Stack direction="row" role="status" sx={{ alignItems: "center", gap: 1 }}><CircularProgress size={16} />{t("purchasing.loading")}</Stack>}
      {error && <Alert severity={error.conflict ? "warning" : "error"} action={<Button color="inherit" disabled={loading} onClick={() => setReload((value) => value + 1)}>{t(error.conflict ? "refresh" : "retry")}</Button>}>
        {error.conflict ? t("purchasing.stale") : error.message || t(view ? "purchasing.saveFailed" : "purchasing.loadFailed")}
      </Alert>}
      {view && !lines.length && <Typography>{t("purchasing.noLines")}</Typography>}
      {lines.length > 0 && <>
        <Stack direction={{ xs: "column", sm: "row" }} sx={{ alignItems: { sm: "center" }, gap: 2 }}>
          <TextField label={t("purchasing.basis")} select value={basis} onChange={(event) => setBasis(event.target.value as Basis)} size="small" disabled={locked} sx={{ minWidth: 180 }}>
            <MenuItem value="last">{t("purchasing.last")}</MenuItem>
            <MenuItem value="average">{t("purchasing.average")}</MenuItem>
          </TextField>
          <Typography color="text.secondary" variant="body2">{t("purchasing.costsNote")}</Typography>
        </Stack>
        {lines.map((line) => {
          const name = itemName(line, i18n.language);
          const bySupplier = quantities[line.id] ?? {};
          const assigned = rowsByLine.get(line.id)!;
          const total = totalsByLine.get(line.id)!;
          const overAllocated = total > decimalInput(line.quantity)!;
          return <Box component="section" key={line.id}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
              {name} · <bdi>{line.sku}</bdi>
            </Typography>
            <Typography variant="body2" color={overAllocated ? "error" : "text.secondary"} sx={{ mb: 1 }}>
              {t("purchasing.allocationState", { allocated: formatQuantity(total), required: line.quantity, unit: line.unitCode })}
            </Typography>
            {!line.suppliers.length && !issued && <Alert severity="warning">{t("purchasing.noSuppliers")}</Alert>}
            {line.suppliers.length > 0 && <TableContainer component={Paper} variant="outlined">
              <Table aria-label={name} size="small">
                <TableHead><TableRow>
                  <TableCell>{t("supplier")}</TableCell><TableCell>{t("purchasing.purchasePrice")}</TableCell>
                  {basis === "last" && <TableCell>{t("purchasing.lastPurchasedAt")}</TableCell>}
                  {!issued && <TableCell>{t("purchasing.allocatedQuantity")}</TableCell>}
                  {editable && <TableCell>{t("actions")}</TableCell>}
                </TableRow></TableHead>
                <TableBody>{line.suppliers.map((supplier) => <TableRow key={supplier.id}>
                  <TableCell component="th" scope="row">
                    <bdi>{supplier.code}</bdi> · <bdi>{supplier.name}</bdi>
                    {supplier.id === line.defaultSupplierId && <Chip label={t("purchasing.defaultSupplier")} size="small" sx={{ marginInlineStart: 1 }} />}
                  </TableCell>
                  <TableCell><Money amount={basis === "last" ? supplier.lastCost : supplier.averageCost} /></TableCell>
                  {basis === "last" && <TableCell>{dateLabel(supplier.lastPurchasedAt, i18n.language)}</TableCell>}
                  {!issued && <TableCell>{editable ? <TextField
                    disabled={locked}
                    error={Boolean(bySupplier[supplier.id]?.trim()) && decimalInput(bySupplier[supplier.id]) === null}
                    onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: { ...current[line.id], [supplier.id]: event.target.value } }))}
                    slotProps={{ htmlInput: { "aria-label": t("purchasing.allocationLabel", { item: name, supplier: supplier.name }), inputMode: "decimal", dir: "ltr" } }}
                    size="small" sx={{ width: 116 }} value={bySupplier[supplier.id] ?? ""}
                  /> : <bdi>{bySupplier[supplier.id] || "—"}</bdi>}</TableCell>}
                  {editable && <TableCell><Button
                    aria-label={t("purchasing.allocateAllLabel", { item: name, supplier: supplier.name })}
                    disabled={locked} onClick={() => setQuantities((current) => ({ ...current, [line.id]: { [supplier.id]: line.quantity } }))} size="small"
                  >{t("purchasing.allocateAll")}</Button></TableCell>}
                </TableRow>)}</TableBody>
              </Table>
            </TableContainer>}
            {!issued && assigned.some((row) => !row.available && row.quantity !== 0n) && <Alert
              severity="warning" sx={{ mt: 1 }}
              action={editable && <Button color="inherit" disabled={locked} onClick={() => setQuantities((current) => ({
                ...current,
                [line.id]: Object.fromEntries(line.suppliers.map((supplier) => [supplier.id, current[line.id]?.[supplier.id] ?? ""])),
              }))}>{t("purchasing.clearUnavailable")}</Button>}
            >{t("purchasing.unavailableSupplier")}</Alert>}
          </Box>;
        })}
        {!issued && <Stack direction={{ xs: "column", sm: "row" }} sx={{ alignItems: { sm: "center" }, gap: 1 }}>
          {editable && <BusyButton busy={pending === "plan"} disabled={locked || !validAllocation || !dirty || (!view?.plan && !allocated.length)} onClick={() => void submitPlan("plan")} variant="outlined">{t("purchasing.savePlan")}</BusyButton>}
          {canIssue && <Button disabled={locked || !view?.plan || dirty || !balanced} onClick={() => setIssueOpen(true)} variant="contained">{t("purchasing.issueSheets")}</Button>}
          {(editable || canIssue) && !balanced && <Typography variant="body2" color="text.secondary">{t("purchasing.balanceRequired")}</Typography>}
        </Stack>}
      </>}
      {Boolean(view?.sheets.length) && <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>{t("purchasing.sheets")}</Typography>}
      {view?.sheets.map((sheet) => <Paper key={sheet.id} variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} sx={{ alignItems: { sm: "center" }, gap: 1, justifyContent: "space-between", mb: 1 }}>
          <Typography component="h4" variant="subtitle1" sx={{ fontWeight: 700 }}><bdi>{sheet.number}</bdi> · <bdi>{sheet.supplierName}</bdi></Typography>
          <Button onClick={() => setPreview(sheet)} startIcon={<PrintOutlinedIcon />} variant="outlined">{t("purchasing.printPreview")}</Button>
        </Stack>
        <TableContainer>
          <Table aria-label={sheet.number} size="small">
            <TableHead><TableRow>
              <TableCell>{t("item")}</TableCell><TableCell>{t("unit")}</TableCell><TableCell>{t("purchasing.originalQuantity")}</TableCell>
              <TableCell>{t("purchasing.estimatedUnitCost")}</TableCell><TableCell>{t("purchasing.purchasedQuantity")}</TableCell>
              <TableCell>{t("purchasing.remainingQuantity")}</TableCell><TableCell>{t("purchasing.actualCost")}</TableCell>
              {canRecord && <TableCell>{t("actions")}</TableCell>}
            </TableRow></TableHead>
            <TableBody>{sheetRows(sheet).map(({ line, allocation }) => <TableRow key={allocation.id}>
              <TableCell component="th" scope="row">{itemName(line, i18n.language)} · <bdi>{line.sku}</bdi></TableCell>
              <TableCell><bdi>{line.unitCode}</bdi></TableCell><TableCell><bdi>{allocation.quantity}</bdi></TableCell>
              <TableCell><Money amount={allocation.estimatedUnitCost} /></TableCell><TableCell><bdi>{allocation.purchasedQuantity}</bdi></TableCell>
              <TableCell><bdi>{formatQuantity(remainingQuantity(allocation))}</bdi></TableCell><TableCell><Money amount={allocation.actualCost} /></TableCell>
              {canRecord && <TableCell>{remainingQuantity(allocation) > 0n && <Button
                aria-label={t("purchasing.recordPurchaseLabel", { item: itemName(line, i18n.language), supplier: sheet.supplierName })}
                disabled={locked} onClick={() => openReceipt(allocation, line, sheet.supplierName)} size="small"
              >{t("purchasing.recordPurchase")}</Button>}</TableCell>}
            </TableRow>)}</TableBody>
          </Table>
        </TableContainer>
      </Paper>)}
      {Boolean(view?.purchases.length) && <>
        <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>{t("purchasing.receiptHistory")}</Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table aria-label={t("purchasing.receiptHistory")} size="small">
            <TableHead><TableRow>
              <TableCell>{t("purchasing.purchasedOn")}</TableCell><TableCell>{t("purchasing.sheet")}</TableCell><TableCell>{t("item")}</TableCell>
              <TableCell>{t("quantity")}</TableCell><TableCell>{t("purchasing.purchasePrice")}</TableCell><TableCell>{t("purchasing.invoiceReference")}</TableCell>
            </TableRow></TableHead>
            <TableBody>{view?.purchases.map((purchase) => {
              const allocation = view.allocations.find((row) => row.id === purchase.allocationId);
              const line = lines.find((row) => row.id === allocation?.requestItemId);
              const sheet = view.sheets.find((row) => row.allocationIds.includes(purchase.allocationId));
              return <TableRow key={purchase.id}>
                <TableCell>{dateLabel(purchase.purchasedOn, i18n.language)}</TableCell>
                <TableCell>{sheet ? <><bdi>{sheet.number}</bdi> · <bdi>{sheet.supplierName}</bdi></> : "—"}</TableCell>
                <TableCell>{line ? itemName(line, i18n.language) : "—"}</TableCell>
                <TableCell><bdi>{purchase.quantity}</bdi> <bdi>{line?.unitCode}</bdi></TableCell>
                <TableCell><Money amount={purchase.unitCost} /></TableCell><TableCell>{purchase.invoiceReference ?? "—"}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </TableContainer>
      </>}
    </Stack>
    {issueOpen && <Dialog fullWidth maxWidth="xs" onClose={pending ? undefined : () => setIssueOpen(false)} open>
      <DialogTitle>{t("purchasing.issueSheets")}</DialogTitle>
      <DialogContent><Typography>{t("purchasing.issueNotice")}</Typography></DialogContent>
      <DialogActions><Button disabled={Boolean(pending)} onClick={() => setIssueOpen(false)}>{t("cancel")}</Button><BusyButton busy={pending === "issue"} onClick={() => void submitPlan("issue")} variant="contained">{t("confirm")}</BusyButton></DialogActions>
    </Dialog>}
    {receipt && <Dialog fullWidth maxWidth="xs" onClose={pending ? undefined : () => setReceipt(null)} open>
      <Box component="form" onSubmit={(event) => { event.preventDefault(); void submitReceipt(); }}>
        <DialogTitle>{t("purchasing.recordPurchase")}</DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            <Typography>{itemName(receipt.line, i18n.language)} · <bdi>{receipt.supplier}</bdi></Typography>
            <Typography variant="body2" color="text.secondary">{t("purchasing.remainingQuantity")} · <bdi>{formatQuantity(remainingQuantity(receipt.allocation))} {receipt.line.unitCode}</bdi></Typography>
            {receiptError && <Alert severity="error">{receiptError}</Alert>}
            <TextField disabled={Boolean(pending) || receipt.uncertain} label={t("quantity")} onChange={(event) => changeReceipt("quantity", event.target.value)} required slotProps={{ htmlInput: { inputMode: "decimal", dir: "ltr" } }} value={receipt.quantity} />
            <TextField disabled={Boolean(pending) || receipt.uncertain} label={`${t("purchasing.purchasePrice")} (${t("purchasing.currency")})`} onChange={(event) => changeReceipt("unitCost", event.target.value)} required slotProps={{ htmlInput: { inputMode: "decimal", dir: "ltr" } }} value={receipt.unitCost} />
            <TextField disabled={Boolean(pending) || receipt.uncertain} label={t("purchasing.purchasedOn")} onChange={(event) => changeReceipt("purchasedOn", event.target.value)} required slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: purchaseToday() } }} type="date" value={receipt.purchasedOn} />
            <TextField disabled={Boolean(pending) || receipt.uncertain} label={t("purchasing.invoiceReference")} onChange={(event) => changeReceipt("invoiceReference", event.target.value)} slotProps={{ htmlInput: { maxLength: maxInvoiceLength } }} value={receipt.invoiceReference} />
            {!receiptValid && receipt.quantity && receipt.unitCost && <Typography variant="body2" color="error">{t("purchasing.receiptValidation")}</Typography>}
          </Stack>
        </DialogContent>
        <DialogActions><Button disabled={Boolean(pending)} onClick={() => setReceipt(null)}>{t("cancel")}</Button><BusyButton busy={pending === "receipt"} disabled={!receiptValid} type="submit" variant="contained">{t(receipt.uncertain ? "retry" : "save")}</BusyButton></DialogActions>
      </Box>
    </Dialog>}
    {preview && <>
      <Dialog fullWidth maxWidth="md" onClose={() => setPreview(null)} open>
        <DialogTitle>{t("purchasing.printPreview")}</DialogTitle>
        <DialogContent><SupplierSheetDocument requestNumber={requestNumber} rows={sheetRows(preview)} sheet={preview} /></DialogContent>
        <DialogActions><Button onClick={() => setPreview(null)}>{t("close")}</Button><Button onClick={() => window.print()} startIcon={<PrintOutlinedIcon />} variant="contained">{t("purchasing.print")}</Button></DialogActions>
      </Dialog>
      {createPortal(<div id="warehouse-supplier-print"><SupplierSheetDocument requestNumber={requestNumber} rows={sheetRows(preview)} sheet={preview} /></div>, document.body)}
    </>}
  </SectionCard>;
}
