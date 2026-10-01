import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CacheProvider } from "@emotion/react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import "./i18n";
import "./styles.css";
import { App } from "./App";
import i18n from "./i18n";
import { createVerdantTheme, getEmotionCache, localeMetadata, resolveLocale, type SupportedLocale } from "./theme";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/noto-kufi-arabic/400.css";
import "@fontsource/noto-kufi-arabic/500.css";
import "@fontsource/noto-kufi-arabic/700.css";
import "@fontsource/noto-nastaliq-urdu/400.css";
import "@fontsource/noto-nastaliq-urdu/500.css";
import "@fontsource/noto-nastaliq-urdu/700.css";

function ProductionRoot() {
  const [locale, setLocale] = useState<SupportedLocale>(() => resolveLocale(i18n.language));
  const metadata = localeMetadata[locale];
  const theme = useMemo(() => createVerdantTheme(locale), [locale]);

  useEffect(() => {
    const onLanguageChanged = (language: string) => setLocale(resolveLocale(language));
    i18n.on("languageChanged", onLanguageChanged);
    return () => i18n.off("languageChanged", onLanguageChanged);
  }, []);

  useEffect(() => {
    document.documentElement.lang = metadata.lang;
    document.documentElement.dir = metadata.direction;
    document.documentElement.dataset.locale = locale;
  }, [locale, metadata.direction, metadata.lang]);

  return (
    <CacheProvider value={getEmotionCache(metadata.direction)}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </CacheProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProductionRoot />
  </StrictMode>,
);
