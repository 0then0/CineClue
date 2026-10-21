export class HttpError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  ifMatch?: string,
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    signal,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(ifMatch ? { "If-Match": `"${ifMatch}"` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({ error: "error" }));
    throw new HttpError(b.error ?? "error");
  }
  return r.json() as Promise<T>;
}
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}
export function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
