export const SESSION_EXPIRED_EVENT = "restaurant:session-expired";

export function notifySessionExpired(status: number, body: unknown) {
  if (
    status === 401 && body && typeof body === "object" &&
    "message" in body && body.message === "Authentication is required."
  ) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}
