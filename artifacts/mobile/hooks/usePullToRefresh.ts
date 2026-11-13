import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { createPullRefresh, runRefresh, type RefreshNotice, type RefreshWork } from "@/lib/pullRefresh";

/** While the notice shows, look again this often, quietly (finding 41). */
const RECHECK_MS = 15_000;

/**
 * Pull to refresh that only spins for a pull you made (Wave 2, finding 10).
 * Background refetches, such as when the app comes back to the front, stay
 * invisible. `work` should return the refetch results (`query.refetch()`, or
 * an array of them) so the spinner stops when they settle.
 *
 * When a pull fails with data still on screen, `notice` says why ("offline"
 * or "failed") for the screen's OfflineNotice (finding 41, decision 195). It
 * clears on the next refresh that works: another pull, Try again (`retry`),
 * coming back to the app, or a quiet look every 15 seconds while it shows.
 * A failed pull with nothing on screen leaves `notice` null; the screen's own
 * "Can't load …" state covers that.
 *
 *   const pull = usePullToRefresh(() => [q.refetch(), other.refetch()]);
 *   <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />
 *   <OfflineNotice pull={pull} />
 */
export function usePullToRefresh(work: RefreshWork) {
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<RefreshNotice>(null);
  const [retrying, setRetrying] = useState(false);
  const workRef = useRef(work);
  workRef.current = work;
  const alive = useRef(true);
  const quietBusy = useRef(false);
  const tracker = useRef<ReturnType<typeof createPullRefresh> | null>(null);
  if (!tracker.current) tracker.current = createPullRefresh(setRefreshing);
  useEffect(
    () => () => {
      alive.current = false;
      tracker.current?.dispose();
    },
    [],
  );

  const onRefresh = useCallback(() => {
    void tracker.current?.pull(() => workRef.current()).then((next) => {
      if (next !== undefined && alive.current) setNotice(next);
    });
  }, []);

  // A refresh with no spinner: Try again, and the quiet looks below.
  const quietCheck = useCallback(async (showRetrying: boolean) => {
    if (quietBusy.current) return;
    quietBusy.current = true;
    if (showRetrying) setRetrying(true);
    const next = await runRefresh(() => workRef.current());
    quietBusy.current = false;
    if (!alive.current) return;
    if (showRetrying) setRetrying(false);
    setNotice(next);
  }, []);

  const retry = useCallback(() => void quietCheck(true), [quietCheck]);

  // While the notice shows: look again when the app comes back to the front
  // (turning Airplane Mode off in Control Center does this) and every so often.
  useEffect(() => {
    if (!notice) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void quietCheck(false);
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void quietCheck(false);
    }, RECHECK_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [notice, quietCheck]);

  return { refreshing, onRefresh, notice, retry, retrying };
}

export type PullToRefresh = ReturnType<typeof usePullToRefresh>;
