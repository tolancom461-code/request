import { describe, expect, it } from "vitest";
import { loadConfig, secureMysqlUrl } from "../apps/api/src/config.js";

describe("secureMysqlUrl", () => {
  it("adds strict TLS only when the source URL has no sslaccept parameter", () => {
    expect(secureMysqlUrl("mysql://user:pass@db.example:4000/app")).toBe("mysql://user:pass@db.example:4000/app?sslaccept=strict");
    expect(secureMysqlUrl("mysql://user:pass@db.example:4000/app?foo=bar")).toContain("foo=bar&sslaccept=strict");
    expect(secureMysqlUrl("mysql://user:pass@db.example:4000/app?sslaccept=strict")).toBe("mysql://user:pass@db.example:4000/app?sslaccept=strict");
  });

  it("prefers the hosting PORT variable over the local API_PORT fallback", () => {
    const config = loadConfig({
      DATABASE_URL: "mysql://user:pass@db.example:4000/app?sslaccept=strict",
      SESSION_SECRET: "a-secure-session-secret-with-more-than-twenty-four-chars",
      API_PORT: "4000",
      PORT: "4010",
    });

    expect(config.API_PORT).toBe(4010);
  });

  it("accepts NODE_ENV=test for the Vitest integration environment", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "mysql://user:pass@db.example:4000/app?sslaccept=strict",
      SESSION_SECRET: "a-secure-session-secret-with-more-than-twenty-four-chars",
    });

    expect(config.NODE_ENV).toBe("test");
  });

  it("permits production startup without REDIS_URL so server-side sessions can use TiDB fallback", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "mysql://user:pass@db.example:4000/app?sslaccept=strict",
      SESSION_SECRET: "a-secure-session-secret-with-more-than-twenty-four-chars",
    });

    expect(config.REDIS_URL).toBeUndefined();
  });
});
