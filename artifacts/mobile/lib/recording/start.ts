// The one way into the recorder, so every entry point (Ball Boi tab, match
// cards, Quick match) goes through the same checks.
//
// Session C's match card calls this for "Record with Ball Boi":
//   import { openRecorder } from "@/lib/recording/start";
//   openRecorder(router, { matchId, opponentName });

import type { useRouter } from "expo-router";

type Router = ReturnType<typeof useRouter>;

export interface RecorderTarget {
  matchId: number;
  opponentName: string;
}

export function openRecorder(router: Router, target: RecorderTarget) {
  router.push({
    pathname: "/record/[matchId]",
    params: { matchId: String(target.matchId), opponent: target.opponentName },
  });
}
