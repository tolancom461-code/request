import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("PWA and i18n foundation", () => {
  it("uses prompt-based updates and no business API runtime cache", async () => {
    const config = await read("../apps/web/vite.config.ts");
    expect(config).toContain('registerType: "prompt"');
    expect(config).toContain("runtimeCaching: []");
    expect(config).toContain('start_url: "/"');
    expect(config).toContain('theme_color: "#087E63"');
  });

  it("contains Arabic, English, and Urdu translations with RTL/LTR direction logic", async () => {
    const i18n = await read("../apps/web/src/i18n.ts");
    const theme = await read("../apps/web/src/theme.ts");
    const main = await read("../apps/web/src/main.tsx");
    expect(i18n).toContain("ar:");
    expect(i18n).toContain("en:");
    expect(i18n).toContain("ur:");
    expect(theme).toContain('ar: {\n    direction: "rtl"');
    expect(theme).toContain('en: {\n    direction: "ltr"');
    expect(main).toContain("document.documentElement.dir");
  });
});
