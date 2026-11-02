import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
export interface Notif { id: number; key: string; kind: string; severity: "info" | "warn" | "urgent"; title: string; body: string | null; link: string | null; created_at: number; read_at: number | null }
export function useNotifications() {
  const [items, setItems] = useState<Notif[]>([]);
  const load = useCallback(() => api<{ items: Notif[] }>("/api/notifications").then((r) => setItems(r.items)).catch(() => undefined), []);
  useEffect(() => { void load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  const act = async (id: number, a: "read" | "dismiss") => { setItems((l) => a === "dismiss" ? l.filter((i) => i.id !== id) : l.map((i) => i.id === id ? { ...i, read_at: Date.now() } : i)); await api(`/api/notifications/${id}/${a}`, { method: "POST" }).catch(() => undefined); };
  const readAll = async () => { setItems((l) => l.map((i) => ({ ...i, read_at: i.read_at ?? Date.now() }))); await api("/api/notifications/read-all", { method: "POST" }).catch(() => undefined); };
  return { items, unread: items.filter((i) => !i.read_at).length, urgent: items.filter((i) => i.severity === "urgent" && !i.read_at), act, readAll, reload: load };
}
