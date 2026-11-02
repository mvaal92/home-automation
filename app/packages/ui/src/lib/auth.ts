/** Client for the auth broker (/api/auth). Adds the CSRF header to every state-changing call. */
import { api } from "./api";
export interface Field { name: string; label: string; type: "text" | "tel" | "email" | "password" | "code" | "nin"; autocomplete?: string; inputmode?: string; maxLength?: number }
export interface Step { session: string; provider: string; state: "form" | "waiting" | "remote" | "redirect" | "done" | "error"; title: string; message?: string; fields?: Field[]; submit?: string; alt?: string; url?: string; external?: boolean; pollMs?: number; insert?: Field; remote?: boolean }
export interface Provider { id: string; name: string; kind: string; method: string; status: string; detail?: string | null; expiresAt?: number | null; autoRenew?: boolean; pending?: string | null; attemptsLeft?: number | null; canLogout: boolean; canRefresh: boolean; remoteCapable: boolean; mock?: boolean }
let csrf: Promise<string> | null = null;
const token = () => (csrf ??= api<{ token: string }>("/api/auth/csrf").then((r) => r.token).catch((e) => { csrf = null; throw e; }));
async function call<T>(path: string, method: string, json?: unknown): Promise<T> { return api<T>(path, { method, json: json ?? {}, headers: { "x-home-csrf": await token() } }); }
export const auth = {
  providers: () => api<{ providers: Provider[]; publicOrigin: string }>("/api/auth/providers"),
  start: (id: string) => call<Step>(`/api/auth/${id}/start`, "POST"),
  step: (s: string, values: Record<string, unknown>) => call<Step>(`/api/auth/session/${s}/step`, "POST", values),
  poll: (s: string) => api<Step>(`/api/auth/session/${s}`),
  cancel: (s: string) => call(`/api/auth/session/${s}`, "DELETE"),
  input: (s: string, ev: Record<string, unknown>) => call(`/api/auth/session/${s}/input`, "POST", ev),
  refresh: (id: string) => call<{ ok: boolean }>(`/api/auth/${id}/refresh`, "POST"),
  logout: (id: string) => call<{ ok: boolean }>(`/api/auth/${id}/logout`, "POST"),
  frameUrl: (s: string, n: number) => `/api/auth/session/${s}/frame?n=${n}`,
};
