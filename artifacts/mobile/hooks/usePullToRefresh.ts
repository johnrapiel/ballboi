import { useCallback, useEffect, useRef, useState } from "react";

import { createPullRefresh, type RefreshWork } from "@/lib/pullRefresh";

/**
 * Pull to refresh that only spins for a pull you made (Wave 2, finding 10).
 * Background refetches, such as when the app comes back to the front, stay
 * invisible. `work` should return the refetch promise (or an array of them)
 * so the spinner stops when they settle.
 *
 *   const pull = usePullToRefresh(() => [q.refetch(), other.refetch()]);
 *   <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />
 */
export function usePullToRefresh(work: RefreshWork) {
  const [refreshing, setRefreshing] = useState(false);
  const workRef = useRef(work);
  workRef.current = work;
  const tracker = useRef<ReturnType<typeof createPullRefresh> | null>(null);
  if (!tracker.current) tracker.current = createPullRefresh(setRefreshing);
  useEffect(() => () => tracker.current?.dispose(), []);
  const onRefresh = useCallback(() => {
    void tracker.current?.pull(() => workRef.current());
  }, []);
  return { refreshing, onRefresh };
}
