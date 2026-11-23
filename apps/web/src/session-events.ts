export const SESSION_EXPIRED_EVENT = "restaurant:session-expired";
export const PAGE_PERMISSION_DENIED_EVENT = "restaurant:page-permission-denied";

export function notifySessionExpired(status: number, body: unknown) {
  if (
    status === 401 && body && typeof body === "object" &&
    "message" in body && body.message === "Authentication is required."
  ) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

export function notifyApiAccess(status: number, body: unknown, method = "GET") {
  notifySessionExpired(status, body);
  if (status !== 403 || method.toUpperCase() !== "GET" || !body || typeof body !== "object") return;
  const permissionDenied = ("code" in body && body.code === "PERMISSION_REQUIRED") ||
    ("message" in body && body.message === "Required permission is missing.");
  if (permissionDenied) {
    window.dispatchEvent(new Event(PAGE_PERMISSION_DENIED_EVENT));
  }
}
