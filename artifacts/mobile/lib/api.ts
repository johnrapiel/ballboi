// Signed-in calls to Ball Boi endpoints that aren't in the generated client yet.
// Prefer the generated React Query hooks from @workspace/api-client-react once an
// endpoint is in lib/api-spec/openapi.yaml.

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

export type TokenGetter = () => Promise<string | null>;

export async function apiFetch(path: string, getToken: TokenGetter, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
}

/** Reads `{ error }` from a failed response, or falls back to a plain message. */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}
