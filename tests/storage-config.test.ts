import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/api/src/config.js";

describe("Phase 4 object-storage configuration", () => {
  it("accepts the approved IDrive e2 endpoint, region, and bucket without exposing credentials", () => {
    const config = loadConfig({
      DATABASE_URL: "mysql://user:pass@db.example:4000/app?sslaccept=strict",
      SESSION_SECRET: "a-secure-session-secret-with-more-than-twenty-four-chars",
      S3_ENDPOINT: "https://s3.eu-central-1.idrivee2.com",
      S3_REGION: "eu-central-1",
      S3_BUCKET: "rpr",
    });

    expect(config.S3_ENDPOINT).toBe("https://s3.eu-central-1.idrivee2.com");
    expect(config.S3_REGION).toBe("eu-central-1");
    expect(config.S3_BUCKET).toBe("rpr");
    expect(config.S3_ACCESS_KEY_ID).toBeUndefined();
    expect(config.S3_SECRET_ACCESS_KEY).toBeUndefined();
  });
});
