import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

describe("Phase 8 notifications, audit and activity UI contract", () => {
  it("registers a notification badge and admin-gated audit/activity navigation", async () => {
    const app = await read("apps/web/src/App.tsx");
    for (const marker of ["Phase8NotificationButton", "isAuditRoute", "AuditActivityWorkspace", 'href="#/admin/audit"', 'href="#/admin/user-activity"', "canManage"]) expect(app).toContain(marker);
  });

  it("uses recipient-owned notification endpoints and CSRF-protected read mutations with no-store refresh", async () => {
    const ui = await read("apps/web/src/components/notifications-audit.tsx");
    for (const marker of ["/notifications/unread-count", "/notifications?", "/notifications/${notice.id}/read", "/notifications/read-all", "/auth/csrf", "X-CSRF-Token", 'cache: "no-store"', "if (!online)"]) expect(ui).toContain(marker);
  });

  it("renders notification loading/empty/error/offline and audit/activity read-only/redaction-safe states", async () => {
    const ui = await read("apps/web/src/components/notifications-audit.tsx");
    for (const marker of ["EmptyState", "ErrorState", "LoadingState", "OfflineNotice", "notificationOffline", "notificationLoadFailed", "auditReadOnly", "AuditTable", "JsonBlock", "/admin/audit-logs", "/admin/users/${activityUserId}/activity"]) expect(ui).toContain(marker);
  });

  it("contains Phase 8 Arabic, English, and Urdu translation keys", async () => {
    const i18n = await read("apps/web/src/i18n.ts");
    for (const key of ["notifications", "notificationCenter", "markAllRead", "notificationOffline", "auditLog", "auditReadOnly", "userActivity", "auditLoadFailed"]) expect(i18n).toContain(`${key}:`);
    expect((i18n.match(/notificationCenter:/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
