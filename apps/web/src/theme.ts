import createCache from "@emotion/cache";
import rtlPlugin from "stylis-plugin-rtl";
import { createTheme, type Direction, type Theme } from "@mui/material/styles";

export type SupportedLocale = "ar" | "en" | "ur";

export const localeMetadata: Record<SupportedLocale, { direction: Direction; fontFamily: string; lang: string }> = {
  ar: {
    direction: "rtl",
    lang: "ar",
    fontFamily: '"Noto Kufi Arabic", Tahoma, Arial, sans-serif',
  },
  en: {
    direction: "ltr",
    lang: "en",
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
  },
  ur: {
    direction: "rtl",
    lang: "ur",
    fontFamily: '"Noto Nastaliq Urdu", "Noto Kufi Arabic", serif',
  },
};

export const verdantTokens = {
  primary: "#087E63",
  primaryDark: "#0D5E50",
  primaryLight: "#EAF6F0",
  accent: "#D7A42B",
  ink: "#123F37",
  success: "#13795B",
  warning: "#B66B00",
  danger: "#B42318",
  background: "#F7FAF8",
  surface: "#FFFFFF",
  divider: "#D7E5DF",
  muted: "#5C7068",
} as const;

const rtlCache = createCache({ key: "verdant-rtl", stylisPlugins: [rtlPlugin] });
const ltrCache = createCache({ key: "verdant-ltr" });

export const getEmotionCache = (direction: Direction) => (direction === "rtl" ? rtlCache : ltrCache);

export const resolveLocale = (language?: string): SupportedLocale => {
  const base = language?.split("-")[0];
  return base === "ar" || base === "ur" || base === "en" ? base : "ar";
};

export const createVerdantTheme = (locale: SupportedLocale): Theme => {
  const metadata = localeMetadata[locale];
  const isUrdu = locale === "ur";

  return createTheme({
    direction: metadata.direction,
    palette: {
      mode: "light",
      primary: { main: verdantTokens.primary, dark: verdantTokens.primaryDark, light: verdantTokens.primaryLight, contrastText: "#FFFFFF" },
      secondary: { main: verdantTokens.accent, dark: "#9B710F", light: "#F7E7B5", contrastText: verdantTokens.ink },
      success: { main: verdantTokens.success },
      warning: { main: verdantTokens.warning },
      error: { main: verdantTokens.danger },
      background: { default: verdantTokens.background, paper: verdantTokens.surface },
      text: { primary: verdantTokens.ink, secondary: verdantTokens.muted },
      divider: verdantTokens.divider,
    },
    shape: { borderRadius: 14 },
    spacing: 8,
    typography: {
      fontFamily: metadata.fontFamily,
      h1: { fontWeight: 700, letterSpacing: isUrdu ? "0" : "-0.02em", lineHeight: isUrdu ? 1.7 : 1.25 },
      h2: { fontWeight: 700, letterSpacing: isUrdu ? "0" : "-0.01em", lineHeight: isUrdu ? 1.65 : 1.3 },
      button: { fontWeight: 700, textTransform: "none", lineHeight: isUrdu ? 1.8 : 1.5 },
      body1: { lineHeight: isUrdu ? 2 : 1.7 },
      body2: { lineHeight: isUrdu ? 1.9 : 1.6 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { backgroundColor: verdantTokens.background },
          body: { backgroundColor: verdantTokens.background, minWidth: 320 },
          "*:focus-visible": { outline: `3px solid ${verdantTokens.accent}`, outlineOffset: 2 },
        },
      },
      MuiButton: { styleOverrides: { root: { minHeight: 44, borderRadius: 12 } } },
      MuiCard: { styleOverrides: { root: { borderRadius: 16, boxShadow: "0 10px 30px rgba(18, 63, 55, 0.08)" } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiDrawer: { styleOverrides: { paper: { borderColor: verdantTokens.divider } } },
      MuiTextField: { defaultProps: { fullWidth: true, variant: "outlined" } },
    },
  });
};
