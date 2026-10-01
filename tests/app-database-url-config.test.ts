import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/api/src/config.js";

describe("application database URL selection", () => {
  it("uses the managed application database URL when provided", () => {
    const config = loadConfig({
      DATABASE_URL: "mysql://builtin.example.invalid:4000/legacy",
      APP_DATABASE_URL: "mysql://managed.example.invalid:4000/restaurant_branch_requisition?sslaccept=strict",
      SESSION_SECRET: "a-long-test-session-secret-value",
    });
    expect(config.DATABASE_URL).toBe("mysql://managed.example.invalid:4000/restaurant_branch_requisition?sslaccept=strict");
  });

  it("keeps the built-in database URL when no managed override exists", () => {
    const config = loadConfig({
      DATABASE_URL: "mysql://builtin.example.invalid:4000/legacy",
      SESSION_SECRET: "a-long-test-session-secret-value",
    });
    expect(config.DATABASE_URL).toBe("mysql://builtin.example.invalid:4000/legacy");
  });
});
