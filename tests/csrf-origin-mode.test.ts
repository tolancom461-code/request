import { describe, expect, it } from "vitest";
import { allowedCsrfOrigins } from "../apps/api/src/session.service.js";

describe("CSRF origin mode", () => {
  it("allows only explicit localhost origins during development", () => {
    const allowed = allowedCsrfOrigins({ NODE_ENV: "development", PUBLIC_APP_ORIGIN: "http://localhost:5173" });
    expect(allowed.has("http://localhost:3000")).toBe(true);
    expect(allowed.has("https://evil.example")).toBe(false);
  });

  it("keeps production pinned to PUBLIC_APP_ORIGIN", () => {
    const allowed = allowedCsrfOrigins({ NODE_ENV: "production", PUBLIC_APP_ORIGIN: "https://app.example" });
    expect(allowed.has("https://app.example")).toBe(true);
    expect(allowed.has("http://localhost:3000")).toBe(false);
  });
});
