import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("session cookie deployment modes", () => {
  it("keeps the __Host cookie in production and uses a browser-valid local name in development", async () => {
    const source = await readFile(path.resolve(import.meta.dirname, "../apps/api/src/session.service.ts"), "utf8");
    expect(source).toContain('this.config.NODE_ENV === "production" || !this.config.SESSION_COOKIE_NAME.startsWith("__Host-")');
    expect(source).toContain('this.config.SESSION_COOKIE_NAME.slice("__Host-".length)');
    expect(source).toContain("secure: production");
    expect(source).toContain("this.sessionCookieName()");
  });
});
