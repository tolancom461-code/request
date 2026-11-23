import { describe, expect, it } from "vitest";
import { documentYear, formatDocumentNumber } from "../src/document-numbering.service.js";

describe("Document number format", () => {
  it("uses at least four digits without wrapping at 9999", () => {
    expect(formatDocumentNumber("Req", 2026, 1n)).toBe("Req-2026-0001");
    expect(formatDocumentNumber("Req", 2026, 9999n)).toBe("Req-2026-9999");
    expect(formatDocumentNumber("Req", 2026, 10000n)).toBe("Req-2026-10000");
  });
  it("changes year at midnight in Riyadh, independently of the server timezone", () => {
    expect(documentYear(new Date("2026-12-31T20:59:59.999Z"))).toBe(2026);
    expect(documentYear(new Date("2026-12-31T21:00:00.000Z"))).toBe(2027);
  });
  it("preserves precision for large sequence values", () => {
    expect(formatDocumentNumber("Req", 2026, 9007199254740993n)).toBe("Req-2026-9007199254740993");
  });
  it("rejects an invalid prefix or non-positive sequence", () => {
    expect(() => formatDocumentNumber("Req-", 2026, 1n)).toThrow();
    expect(() => formatDocumentNumber("Req", 2026, 0n)).toThrow();
  });
});
