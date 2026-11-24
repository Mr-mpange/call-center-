import { useCallback, useEffect, useState } from "react";

const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");
// Use the IPv4 loopback explicitly in local development. On macOS, `localhost`
// may resolve to an unrelated IPv6 listener on port 3000 before this API.
const defaultBase = import.meta.env.DEV ? "http://127.0.0.1:3000/api" : "/api";
export const API_BASE_URL = configuredBase || defaultBase;

type ApiEnvelope<T> = { data?: T; [key: string]: unknown };

function token() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("mpange.auth.token") ?? "";
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 15_000): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const auth = token();
  if (auth) headers.set("Authorization", `Bearer ${auth}`);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const signal = init?.signal ?? controller.signal;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/${path.replace(/^\//, "")}`, { ...init, headers, signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw new Error("Request timed out or was cancelled");
    throw new Error(cause instanceof Error ? cause.message : "Network request failed");
  } finally {
    window.clearTimeout(timeout);
  }
  const text = await response.text();
  let payload: ApiEnvelope<T> | T = {} as ApiEnvelope<T>;
  try { payload = text ? JSON.parse(text) : ({} as ApiEnvelope<T>); } catch { payload = text as T; }
  if (!response.ok) {
    const message = typeof payload === "object" && payload && "error" in payload ? String((payload as { error: unknown }).error) : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export function apiGet<T>(path: string) { return request<T>(path); }
export function apiPost<T>(path: string, body?: unknown) { return request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }); }
export function apiPostAudio<T>(path: string, file: File, languageHint: string) {
  const query = new URLSearchParams({ languageHint });
  return request<T>(`${path}?${query.toString()}`, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream", "X-Audio-Filename": file.name } }, 120_000);
}
export function apiPatch<T>(path: string, body: unknown) { return request<T>(path, { method: "PATCH", body: JSON.stringify(body) }); }
export function apiPut<T>(path: string, body: unknown) { return request<T>(path, { method: "PUT", body: JSON.stringify(body) }); }
export function apiDelete<T>(path: string) { return request<T>(path, { method: "DELETE" }); }

export function extractData<T>(payload: ApiEnvelope<T> | T, key?: string, fallback?: T): T {
  if (payload && typeof payload === "object") {
    if ("data" in payload && (payload as ApiEnvelope<T>).data !== undefined) return (payload as ApiEnvelope<T>).data as T;
    if (key && key in payload) return (payload as ApiEnvelope<T>)[key] as T;
  }
  return (payload as T) ?? (fallback as T);
}

export function useApiCollection<T>(path: string, _fallback: T[], key?: string, enabled = true) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const payload = await apiGet<ApiEnvelope<T[]>>(path);
      setItems(extractData(payload, key, []) ?? []);
      setError(null);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "Backend unavailable");
    } finally {
      setLoading(false);
    }
  }, [enabled, key, path]);
  useEffect(() => { void reload(); }, [reload]);
  return { items, setItems, loading, error, reload };
}

export function useApiResource<T>(path: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiGet<ApiEnvelope<T>>(path);
      setValue(extractData(payload, undefined, fallback));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backend unavailable");
    } finally {
      setLoading(false);
    }
  }, [fallback, path]);
  useEffect(() => { void reload(); }, [reload]);
  return { value, setValue, loading, error, reload };
}
