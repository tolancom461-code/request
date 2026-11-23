import { I18nextProvider } from "react-i18next";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "../i18n";
import { DocumentNumberingPage } from "./document-numbering";

beforeEach(async () => { await i18n.changeLanguage("ar"); });
describe("Numbering center", () => {
  test("shows current-year document references and refreshes without issuing a number", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ year: 2026, timeZone: "Asia/Riyadh", series: [{ type: "requisition", prefix: "Req", lastValue: "12", lastNumber: "Req-2026-0012" }] }), { status: 200 })));
    const user = userEvent.setup();
    render(<I18nextProvider i18n={i18n}><DocumentNumberingPage online /></I18nextProvider>);
    await screen.findByText("Req-2026-0012");
    expect(screen.getByText("السنة الحالية: 2026")).toBeTruthy();
    expect(screen.getByText("طلب احتياج")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: i18n.t("refresh") }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    for (const [path, init] of vi.mocked(fetch).mock.calls) {
      expect(path).toBe("/api/v1/admin/document-numbering");
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.cache).toBe("no-store");
    }
  });
  test("does not call the server while offline", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<I18nextProvider i18n={i18n}><DocumentNumberingPage online={false} /></I18nextProvider>);
    expect(screen.getByText(i18n.t("adminOffline"))).toBeTruthy();
    expect(screen.getByRole("button", { name: i18n.t("refresh") })).toHaveProperty("disabled", true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
