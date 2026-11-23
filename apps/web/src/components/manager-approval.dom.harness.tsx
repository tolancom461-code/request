import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, test, vi } from "vitest";
import i18n from "../i18n";
import { ManagerApprovalPage } from "./manager-approval";

const id = "10000000-0000-4000-8000-000000000001";
const detail = {
  id,
  requestNumber: "Req-2026-0001",
  branch: { code: "B1", nameAr: "الفرع الأول", nameEn: "Branch One" },
  creator: { username: "employee" },
  status: "pending_approval",
  rowVersion: 1,
  submittedAt: null,
  items: [],
  statusHistory: [],
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(detail), { headers: { "Content-Type": "application/json" } })));
});

describe("Manager decision permissions", () => {
  test("a reviewer can open the request while each decision independently requires its own grant", async () => {
    const renderReview = (permissions: string[]) => (
      <I18nextProvider i18n={i18n}>
        <ManagerApprovalPage online path={`#/manager/requisitions/${id}/review`} onNavigate={() => undefined} permissions={permissions} />
      </I18nextProvider>
    );
    const view = render(renderReview(["request.review"]));
    await screen.findByRole("heading", { name: new RegExp(detail.requestNumber) });
    for (const key of ["managerApprove", "managerReturn", "managerReject"]) {
      expect(screen.queryByRole("button", { name: i18n.t(key) })).toBeNull();
    }
    for (const [grant, button] of [["request.approve", "managerApprove"], ["request.return", "managerReturn"], ["request.reject", "managerReject"]]) {
      view.rerender(renderReview(["request.review", grant]));
      expect(screen.getByRole("button", { name: i18n.t(button) })).toBeTruthy();
      for (const key of ["managerApprove", "managerReturn", "managerReject"].filter(key => key !== button)) {
        expect(screen.queryByRole("button", { name: i18n.t(key) })).toBeNull();
      }
    }
  });
});
