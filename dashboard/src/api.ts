import type { LoginPoll, LoginStart, Realm, StatusPayload } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) {
    throw new Error(`非 JSON 响应（HTTP ${res.status}）`);
  }
  return (await res.json()) as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const api = {
  status: () => request<StatusPayload>("/api/status"),

  logs: (name: string, lines = 150) =>
    request<{ name: string; text: string }>(`/api/logs?name=${encodeURIComponent(name)}&lines=${lines}`),

  loginStart: (realm: Realm) => post<LoginStart>("/api/login/start", { realm }),

  loginPoll: (state: string) =>
    request<LoginPoll>(`/api/login/poll?state=${encodeURIComponent(state)}`),

  loginCancel: (state: string) => post<{ cancelled?: boolean }>("/api/login/cancel", { state }),

  refreshAccounts: () => post<Record<string, unknown>>("/api/accounts/refresh", {}),

  service: (action: "start" | "stop" | "restart") =>
    post<{ ok?: boolean; code?: number; output?: string; error?: string }>("/api/service", { action }),
};
