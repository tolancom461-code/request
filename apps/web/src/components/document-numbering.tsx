import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { notifySessionExpired } from "../session-events";
import { ErrorState, LoadingState, PageHeader, SectionCard } from "./foundation";

type NumberingStatus = { year: number; timeZone: string; series: Array<{ type: string; prefix: string; lastValue: string; lastNumber: string | null }> };
export function DocumentNumberingPage({ online }: { online: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = useState<NumberingStatus | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/v1/admin/document-numbering", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      notifySessionExpired(response.status, body);
      if (!response.ok) throw new Error();
      setData(body);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [online]);
  useEffect(() => { void load(); }, [load]);
  return <>
    <PageHeader title={t("numberingCenter")} description={t("numberingDescription")} actions={<Button disabled={!online || loading} onClick={() => void load()}>{t("refresh")}</Button>} />
    <SectionCard>
      {!online ? <Typography>{t("adminOffline")}</Typography> : loading ? <LoadingState title={t("loadingTitle")} message={t("loadingDescription")} /> : error ? <ErrorState title={t("loadFailed")} message={t("numberingLoadFailed")} action={<Button onClick={() => void load()}>{t("retry")}</Button>} /> : data && <>
        <Typography sx={{ mb: 2 }}>{t("numberingYear", { year: data.year })}</Typography>
        <TableContainer><Table><TableHead><TableRow>
          <TableCell>{t("numberingType")}</TableCell><TableCell>{t("numberingPrefix")}</TableCell><TableCell>{t("numberingLast")}</TableCell>
        </TableRow></TableHead><TableBody>{data.series.map(row => <TableRow key={row.type}>
          <TableCell>{t(`numberingTypes.${row.type}`)}</TableCell><TableCell><span dir="ltr">{row.prefix}</span></TableCell><TableCell><span dir="ltr">{row.lastNumber ?? t("numberingNotStarted")}</span></TableCell>
        </TableRow>)}</TableBody></Table></TableContainer>
      </>}
    </SectionCard>
  </>;
}
