// Profile photos are stored as "/objects/<key>" paths and served by the API.

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

/** "/objects/uploads/abc" → "<api>/api/storage/objects/uploads/abc". */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return path.startsWith("/objects/") ? `${API_BASE}/api/storage${path}` : null;
}
