import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createVerdantTheme, localeMetadata, resolveLocale, verdantTokens } from "../apps/web/src/theme.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("Phase 2C selected T3 + I1 production foundation", () => {
  it("maps Arabic and Urdu to RTL and English to LTR", () => {
    expect(localeMetadata.ar.direction).toBe("rtl");
    expect(localeMetadata.ur.direction).toBe("rtl");
    expect(localeMetadata.en.direction).toBe("ltr");
    expect(resolveLocale("ar-SA")).toBe("ar");
    expect(resolveLocale("en-GB")).toBe("en");
    expect(resolveLocale("ur-PK")).toBe("ur");
  });

  it("applies the locked Verdant Operations tokens through Material UI themes", () => {
    const arabic = createVerdantTheme("ar");
    const english = createVerdantTheme("en");
    expect(arabic.direction).toBe("rtl");
    expect(english.direction).toBe("ltr");
    expect(arabic.palette.primary.main).toBe(verdantTokens.primary);
    expect(arabic.palette.secondary.main).toBe(verdantTokens.accent);
    expect(arabic.palette.error.main).toBe(verdantTokens.danger);
    expect(arabic.shape.borderRadius).toBe(14);
  });

  it("uses real Material UI shell, login, responsive drawer, and shared-state primitives", async () => {
    const app = await read("../apps/web/src/App.tsx");
    const foundation = await read("../apps/web/src/components/foundation.tsx");
    const main = await read("../apps/web/src/main.tsx");
    expect(main).toContain("ThemeProvider");
    expect(main).toContain("CssBaseline");
    expect(app).toContain("/api/v1/auth/login");
    expect(app).toContain('variant={compact ? "temporary" : "permanent"}');
    expect(app).toContain('const compact = useMediaQuery(theme.breakpoints.down("lg")');
    expect(app).toContain('anchor="left"');
    expect(app).toContain('marginLeft: { lg: `${drawerWidth}px` }');
    expect(app).toContain("<AppBar");
    expect(app).toContain("<Toolbar");
    expect(app).toContain("<TextField");
    expect(app).toContain("<Table");
    expect(foundation).toContain("function LoadingState");
    expect(foundation).toContain("function ErrorState");
    expect(foundation).toContain("function OfflineNotice");
    expect(foundation).toContain("function ScopeDialog");
  });

  it("does not expose dead future-module navigation or introduce a competing UI framework", async () => {
    const app = await read("../apps/web/src/App.tsx");
    const manifest = await read("../apps/web/package.json");
    expect(app).toContain('href="#dashboard"');
    expect(app).not.toContain("Requests");
    expect(app).not.toContain("Approvals");
    expect(manifest).toContain('"@mui/material": "9.3.1"');
    expect(manifest).not.toContain("flowbite-react");
    expect(manifest).not.toContain("@mantine/core");
  });
});
