import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef } from "react";

import { useGetMyLeagueWeek } from "@workspace/api-client-react";

import { ROUND_SINGULAR } from "@/components/league/Bracket";
import { useUpcomingMatchPlans } from "@/hooks/useDiscoverMatchPlans";
import { useMyOpenMatches } from "@/hooks/useDiscoverOpenMatches";
import { upcomingList, type UpcomingItem } from "@/lib/upcoming";

// Every match you still have to play (decision 137): this week's league
// matches, playoffs and matches set up in Discover, in date order. Used by
// Home and Profile. Comes back to fresh data each time the screen regains
// focus, so a score, edit, join or cancel shows straight away (C4).

const stage = (round: string) => ROUND_SINGULAR[round as keyof typeof ROUND_SINGULAR] ?? "Playoffs";

export function useUpcomingMatches() {
  const weekQ = useGetMyLeagueWeek();
  const plansQ = useUpcomingMatchPlans();
  const openQ = useMyOpenMatches();
  const items = useMemo(
    () => upcomingList({ week: weekQ.data, plans: plansQ.data?.matches, open: openQ.data?.matches, stage }),
    [weekQ.data, plansQ.data, openQ.data],
  );
  const refetchWeek = weekQ.refetch;
  const refetchPlans = plansQ.refetch;
  const refetchOpen = openQ.refetch;
  const refetch = useCallback(() => {
    void refetchWeek();
    void refetchPlans();
    void refetchOpen();
  }, [refetchWeek, refetchPlans, refetchOpen]);

  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // The first focus is the first load; after that, come back to fresh data.
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refetch();
    }, [refetch]),
  );

  return {
    items,
    week: weekQ.data,
    isLoading: weekQ.isLoading,
    isError: weekQ.isError,
    isRefetching: weekQ.isRefetching || plansQ.isRefetching || openQ.isRefetching,
    refetch,
  };
}

/** Where a tap on an upcoming match goes. */
export function useOpenUpcoming() {
  const router = useRouter();
  return useCallback(
    (m: UpcomingItem) => {
      if (m.kind === "open" && m.openMatchId != null) {
        router.push({
          pathname: m.openStatus === "Full" ? "/discover/match/chat/[id]" : "/discover/match/[id]",
          params: { id: String(m.openMatchId) },
        });
        return;
      }
      if (m.kind === "discover") {
        // An upcoming Discover match opens your chat with the other player,
        // where its card lives. Once it has a result it's on Profile's
        // Results and opens Match detail (decision 151).
        if (m.otherUserId) router.push({ pathname: "/conversation/[id]", params: { id: "new", userId: String(m.otherUserId), name: m.opponentName ?? "" } });
        return;
      }
      if (m.matchId) router.push(`/match/${m.matchId}`);
      else if (m.leagueId) router.push(`/league/${m.leagueId}`);
    },
    [router],
  );
}

/** The VoiceOver hint for a row, saying where it goes. */
export function upcomingHint(m: UpcomingItem): string {
  if (m.kind === "open") return m.openStatus === "Full" ? "Opens the group chat" : "Opens the match";
  if (m.kind === "discover") return `Opens your chat with ${m.opponentName}`;
  return "Opens the match";
}
