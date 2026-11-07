import { useAuth } from "@clerk/expo";
import { useRef, useState } from "react";

import { latestCaller } from "@/lib/latestCaller";

type GetToken = ReturnType<typeof useAuth>["getToken"];

/**
 * Clerk's `getToken`, as one function that stays the same across renders, so
 * it's safe in effect and callback dependencies (finding #1). Use this, not
 * `useAuth().getToken`, anywhere a `useEffect`, `useCallback` or
 * `useFocusEffect` lists `getToken`.
 */
export function useStableGetToken(): GetToken {
  const { getToken } = useAuth();
  const ref = useRef(getToken);
  ref.current = getToken;
  const [stable] = useState(() => latestCaller(() => ref.current));
  return stable;
}
