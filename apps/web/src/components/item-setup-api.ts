import { notifyApiAccess } from "../session-events";

export class ItemSetupApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
  });
  const payload = await response.json().catch(() => null);
  notifyApiAccess(response.status, payload, init?.method);
  if (!response.ok)
    throw new ItemSetupApiError(payload?.message ?? `HTTP ${response.status}`, response.status);
  return payload as T;
}

export async function mutate<T>(
  path: string,
  body: unknown,
  method = "POST"
): Promise<T> {
  const csrf = await api<{ csrfToken: string }>("/api/v1/auth/csrf");
  const multipart = body instanceof FormData;
  return api<T>(path, {
    method,
    headers: {
      "X-CSRF-Token": csrf.csrfToken,
      ...(multipart ? {} : { "Content-Type": "application/json" }),
    },
    body: multipart ? body : JSON.stringify(body),
  });
}
