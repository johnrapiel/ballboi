// Finding 10 (Wave 2): the pull-to-refresh spinner shows only for a pull the
// player made. Queries also refetch quietly when the app comes back to the
// front (focusManager in app/_layout.tsx); binding the spinner to React
// Query's isRefetching made iOS show it for that background refresh and
// sometimes leave the page stuck pushed down.

/** What a screen does when you pull: start its refetches. */
export type RefreshWork = () => unknown;

/**
 * Tracks one user-pulled refresh. `pull` turns the spinner on, runs the work,
 * and turns it off when every refetch has settled, whether it worked or
 * failed, so it can never stay stuck. A second pull while one is running is
 * ignored. `dispose` stops a late settle from touching an unmounted screen.
 */
export function createPullRefresh(setRefreshing: (on: boolean) => void) {
  let running = false;
  let disposed = false;
  return {
    /**
     * Resolves with the notice to show (finding 41), or undefined when the
     * pull was ignored because another was running or the screen had gone.
     */
    async pull(work: RefreshWork): Promise<RefreshNotice | undefined> {
      if (running || disposed) return undefined;
      running = true;
      setRefreshing(true);
      try {
        // Work may throw, return one promise, or an array of them.
        return await runRefresh(work);
      } finally {
        running = false;
        if (!disposed) setRefreshing(false);
      }
    },
    dispose() {
      disposed = true;
    },
  };
}

// Finding 41 (Wave 2, decision 195): when a refresh fails, the screen keeps
// what it showed and says so quietly at the top ("You're offline. Showing
// what was here earlier."). The full "Can't load …" error is only for a
// screen with nothing to show; each screen draws that one itself.

/**
 * What the quiet notice at the top of a screen says, if anything:
 * - "offline": a refresh failed because the phone has no connection.
 * - "failed": a refresh failed for another reason (a server error).
 * - null: no notice. Either everything refreshed, or what failed had nothing
 *   on screen yet, so the screen shows its own "Can't load …" instead.
 */
export type RefreshNotice = "offline" | "failed" | null;

/** The request never got an answer: Airplane Mode, no signal, a dropped connection. */
export function isConnectionError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { name, message } = e as { name?: unknown; message?: unknown };
  // lib/api.ts's OfflineError, for calls outside the generated client.
  if (name === "OfflineError") return true;
  // The generated client lets fetch's own failure through: on iOS a TypeError
  // "Network request failed". A server's answer is an ApiError instead.
  if (name === "TypeError" && typeof message === "string") {
    return /network request failed|network connection|internet connection|offline|timed out/i.test(message);
  }
  return false;
}

interface QueryResultLike {
  status: string;
  data?: unknown;
  error?: unknown;
}

function isQueryResult(v: unknown): v is QueryResultLike {
  return !!v && typeof v === "object" && "status" in v && "data" in v && typeof (v as { status: unknown }).status === "string";
}

/** Flattens what a pull's work returned: one value, a promise, or nested arrays of them. */
async function settleAll(value: unknown): Promise<PromiseSettledResult<unknown>[]> {
  const items = Array.isArray(value) ? value : [value];
  const settled = await Promise.allSettled(items);
  const out: PromiseSettledResult<unknown>[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && Array.isArray(s.value)) out.push(...(await settleAll(s.value)));
    else out.push(s);
  }
  return out;
}

/**
 * Reads the settled refetches (React Query results, as `query.refetch()`
 * returns them) and decides the notice. A failed refetch only earns the
 * notice when its query still has data on screen; a work function that threw
 * tells us nothing about what's on screen, so it never does.
 */
export function noticeFor(settled: PromiseSettledResult<unknown>[]): RefreshNotice {
  let stale = false;
  let offline = false;
  for (const s of settled) {
    if (s.status !== "fulfilled" || !isQueryResult(s.value)) continue;
    const r = s.value;
    if (r.status !== "error") continue;
    if (r.data === undefined) continue;
    stale = true;
    if (isConnectionError(r.error)) offline = true;
  }
  if (!stale) return null;
  return offline ? "offline" : "failed";
}

/** Runs a screen's refresh work and decides the notice. Never throws. */
export async function runRefresh(work: RefreshWork): Promise<RefreshNotice> {
  try {
    return noticeFor(await settleAll(work()));
  } catch {
    return null;
  }
}

/** The notice's words. Kept here so tests and the spec quote one place. */
export const OFFLINE_NOTICE_TEXT = "You're offline. Showing what was here earlier.";
export const FAILED_NOTICE_TEXT = "Couldn't refresh. Showing what was here earlier.";
