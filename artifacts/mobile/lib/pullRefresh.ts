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
    async pull(work: RefreshWork): Promise<void> {
      if (running || disposed) return;
      running = true;
      setRefreshing(true);
      try {
        // Work may throw, return one promise, or an array of them.
        const result = work();
        await Promise.allSettled(Array.isArray(result) ? result : [result]);
      } catch {
        // A failed refetch shows the screen's own error; the spinner just stops.
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
