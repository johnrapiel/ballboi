const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function apiUrl(path: string) {
  return `${BASE}/api${path}`;
}

export async function apiFetch(path: string, token: string | null, options?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(apiUrl(path), { ...options, headers: { ...headers, ...(options?.headers as Record<string, string> ?? {}) } });
  return res;
}

export function getWeekOf(offset = 0): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().slice(0, 10);
}

export function formatWeekRange(weekOf: string): string {
  const start = new Date(weekOf);
  const end = new Date(weekOf);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}`;
}

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6 AM to 9 PM

export function hourLabel(h: number): string {
  if (h === 0 || h === 12) return h === 0 ? "12 AM" : "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
