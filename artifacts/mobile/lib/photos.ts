// Profile photos are stored as "/objects/<key>" paths and served by the API.

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

/** "/objects/uploads/abc" → "<api>/api/storage/objects/uploads/abc". */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return path.startsWith("/objects/") ? `${API_BASE}/api/storage${path}` : null;
}

/**
 * What an avatar shows for a photo value from anywhere in the app: a stored
 * "/objects/..." path becomes its API URL, a full URL or a photo just picked
 * on the phone (file://, ph://) is used as it is, and anything else is no
 * photo (initials). `Avatar` runs every `uri` through this, so a screen can
 * hand it the raw `avatarUrl` the API sent.
 */
export function avatarUri(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isApiPhoto(value)) return value;
  if (value.startsWith("/")) return photoUrl(value);
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : null;
}

/** True for a photo the API serves, which needs the sign-in header (A17). A photo just picked on the phone doesn't. */
export function isApiPhoto(uri: string): boolean {
  return uri.startsWith(`${API_BASE}/api/storage/objects/`);
}

export type PhotoSource = { uri: string; headers?: Record<string, string> };

/**
 * The image source for a photo. An API photo carries the Clerk session token
 * as `Authorization: Bearer`, the same header the rest of the app sends, and
 * is null until there's a token, so it never loads signed out.
 */
export function photoSource(uri: string, token: string | null | undefined): PhotoSource | null {
  if (!isApiPhoto(uri)) return { uri };
  if (!token) return null;
  return { uri, headers: { Authorization: `Bearer ${token}` } };
}

// ─── Uploading a picked photo (finding #23) ──────────────────────────────────

const PHOTO_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
};

/**
 * The Content-Type for a picked photo. Uses what the picker said when it's an
 * image type the API takes, then the file's extension (the picker can leave
 * `mimeType` empty), and otherwise JPEG, which is what the picker writes
 * after cropping.
 */
export function photoContentType(mimeType: string | null | undefined, uri: string): string {
  const given = mimeType?.split(";")[0].trim().toLowerCase();
  if (given && Object.values(PHOTO_TYPE_BY_EXTENSION).includes(given)) return given;
  const ext = uri.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return PHOTO_TYPE_BY_EXTENSION[ext] ?? "image/jpeg";
}
