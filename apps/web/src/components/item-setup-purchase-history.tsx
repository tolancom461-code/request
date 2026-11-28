import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { SectionCard } from "./foundation";
import { api } from "./item-setup-api";
import { OpeningPurchasesDialog, type OpeningPurchaseSupplier, type OpeningPurchaseUnit } from "./item-setup-opening-purchases";

type PurchaseHistory = {
  unitCode: string;
  suppliers: Array<{
    id: string;
    code: string;
    name: string;
    lastCost: string | null;
    averageCost: string | null;
    lastPurchasedAt: string | null;
  }>;
  purchases: Array<{
    id: string;
    supplierId: string;
    supplierCode: string;
    supplierName: string;
    quantity: string;
    unitCode: string;
    unitCost: string;
    purchasedOn: string;
    invoiceReference: string | null;
    source: "opening" | "warehouse";
  }>;
  openingSuppliers: OpeningPurchaseSupplier[];
  units: OpeningPurchaseUnit[];
  page: number;
  pageSize: number;
  total: number;
};

export function ItemPurchaseHistory({
  itemId,
  itemLabel,
  online,
  version,
}: {
  itemId: string;
  itemLabel: string;
  online: boolean;
  version: number;
}) {
  const { t } = useTranslation();
  const [supplierId, setSupplierId] = useState("");
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<{
    supplierId: string;
    history: PurchaseHistory;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState(false);
  const [openingSaved, setOpeningSaved] = useState(false);

  useEffect(() => {
    if (!online) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page) });
    if (supplierId) query.set("supplierId", supplierId);
    setLoading(true);
    setFailed(false);
    void api<PurchaseHistory>(
      `/api/v1/admin/item-setup/items/${itemId}/purchase-history?${query}`,
      { signal: controller.signal }
    )
      .then(result => {
        if (controller.signal.aborted) return;
        if (supplierId && !result.suppliers.some(supplier => supplier.id === supplierId)) {
          setSupplierId("");
          setPage(1);
        }
        setResponse({ supplierId, history: result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [itemId, online, page, retry, supplierId, version]);

  const history = response?.history;
  if (!online && !history) return null;
  const matchingPage = response?.supplierId === supplierId && history?.page === page;
  const totalPages = matchingPage ? Math.ceil(history.total / history.pageSize) : 0;
  const canEnterOpening = Boolean(history?.openingSuppliers?.length && history.units?.length);
  return (
    <Box sx={{ mt: 2 }}>
      <SectionCard title={t("setup.purchaseHistory")} action={canEnterOpening && (
        <Button variant="outlined" disabled={!online || loading} onClick={() => { setOpeningSaved(false); setOpening(true); }}>
          {t("setup.openingPurchases")}
        </Button>
      )}>
        {loading && <LinearProgress aria-label={t("loadingTitle")} />}
        {failed && (
          <Alert
            severity="error"
            action={
              <Button disabled={!online} onClick={() => setRetry(value => value + 1)}>
                {t("retry")}
              </Button>
            }
          >
            {t("setup.purchaseHistoryFailed")}
          </Alert>
        )}
        {openingSaved && <Alert severity="success" sx={{ mb: 2 }}>{t("setup.openingSaved")}</Alert>}
        {history && (
          <Box sx={{ display: "grid", minWidth: 0, gap: 2 }}>
            {history.suppliers.length > 0 && (
              <>
                {history.unitCode && (
                  <Typography variant="body2" color="text.secondary">
                    {t("setup.costPerBaseUnit", { unit: history.unitCode })}
                  </Typography>
                )}
                <TableContainer>
                  <Table size="small" aria-label={t("setup.purchaseCostComparison")}>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("supplier")}</TableCell>
                        <TableCell>{t("setup.lastPurchaseCost")}</TableCell>
                        <TableCell>{t("setup.averagePurchaseCost")}</TableCell>
                        <TableCell>{t("setup.purchaseDate")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {history.suppliers.map(supplier => (
                        <TableRow key={supplier.id}>
                          <TableCell>{supplier.code} · {supplier.name}</TableCell>
                          <TableCell>{supplier.lastCost ?? "—"}</TableCell>
                          <TableCell>{supplier.averageCost ?? "—"}</TableCell>
                          <TableCell>{supplier.lastPurchasedAt?.slice(0, 10) ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TextField
                  select
                  label={t("setup.historySupplier")}
                  value={supplierId}
                  disabled={!online || loading}
                  onChange={event => {
                    setSupplierId(event.target.value);
                    setPage(1);
                  }}
                  sx={{ width: "min(100%, 320px)" }}
                >
                  <MenuItem value="">{t("setup.allHistorySuppliers")}</MenuItem>
                  {history.suppliers.map(supplier => (
                    <MenuItem key={supplier.id} value={supplier.id}>
                      {supplier.code} · {supplier.name}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}
            {!loading && !failed && matchingPage && (
              history.purchases.length > 0 ? (
                <TableContainer>
                  <Table size="small" aria-label={t("setup.purchaseHistory")}>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("setup.purchaseDate")}</TableCell>
                        <TableCell>{t("supplier")}</TableCell>
                        <TableCell>{t("quantity")}</TableCell>
                        <TableCell>{t("unit")}</TableCell>
                        <TableCell>{t("setup.actualUnitCost")}</TableCell>
                        <TableCell>{t("setup.invoiceReference")}</TableCell>
                        <TableCell>{t("setup.purchaseSource")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {history.purchases.map(purchase => (
                        <TableRow key={purchase.id}>
                          <TableCell>{purchase.purchasedOn}</TableCell>
                          <TableCell>{purchase.supplierCode} · {purchase.supplierName}</TableCell>
                          <TableCell>{purchase.quantity}</TableCell>
                          <TableCell>{purchase.unitCode}</TableCell>
                          <TableCell>{purchase.unitCost}</TableCell>
                          <TableCell>{purchase.invoiceReference ?? "—"}</TableCell>
                          <TableCell>{t(purchase.source === "opening" ? "setup.sourceOpening" : "setup.sourceWarehouse")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography color="text.secondary">{t("setup.noPurchaseHistory")}</Typography>
              )
            )}
            {totalPages > 1 && (
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <Button disabled={!online || loading || page <= 1} onClick={() => setPage(page - 1)}>
                  {t("previous")}
                </Button>
                <Typography variant="body2">{page} / {totalPages}</Typography>
                <Button disabled={!online || loading || page >= totalPages} onClick={() => setPage(page + 1)}>
                  {t("next")}
                </Button>
              </Box>
            )}
          </Box>
        )}
      </SectionCard>
      {opening && canEnterOpening && history && (
        <OpeningPurchasesDialog
          itemId={itemId} itemLabel={itemLabel} online={online} suppliers={history.openingSuppliers} units={history.units} baseUnitCode={history.unitCode}
          onClose={() => setOpening(false)}
          onSaved={() => {
            setOpening(false);
            setOpeningSaved(true);
            setSupplierId("");
            setPage(1);
            setRetry(value => value + 1);
          }}
        />
      )}
    </Box>
  );
}
