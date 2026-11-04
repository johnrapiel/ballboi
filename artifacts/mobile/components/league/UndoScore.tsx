import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Alert, Pressable } from "react-native";

import { getGetLeagueScheduleQueryKey, useUndoLeagueScore } from "@workspace/api-client-react";

import { Text } from "@/components/ui";
import { MIN_TAP } from "@/constants/tokens";
import { countdownLabel, countdownSpoken, undoSecondsLeft } from "@/lib/leagueSchedule";
import { refreshLeague } from "@/lib/leagueRefresh";

// C4 (Oct 31 review): the player who entered a score can undo it for 10
// minutes, with a visible countdown. Undo clears the score and standings
// recompute. After 10 minutes the link goes away and the first score stands.

export function UndoScore({
  leagueId,
  matchId,
  undoUntil,
  align = "flex-end",
}: {
  leagueId: number;
  matchId: number;
  undoUntil: string | null | undefined;
  align?: "flex-start" | "flex-end";
}) {
  const queryClient = useQueryClient();
  const undo = useUndoLeagueScore();
  const [now, setNow] = useState(() => Date.now());
  const left = undoSecondsLeft(undoUntil, now);

  // Tick once a second while the window is open; refresh when it closes so the
  // card shows the score as final.
  useEffect(() => {
    if (!undoUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [undoUntil]);
  useEffect(() => {
    if (undoUntil && left === 0) void queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) });
  }, [left, undoUntil, leagueId, queryClient]);

  if (!undoUntil || left === 0) return null;

  // C4: Home, standings and the league all show the match as unplayed again.
  const refresh = () => refreshLeague(queryClient, leagueId);

  function confirm() {
    if (undo.isPending) return;
    Alert.alert("Undo this score?", "The match goes back to not played. You can enter the score again.", [
      { text: "Keep score", style: "cancel" },
      {
        text: "Undo score",
        style: "destructive",
        onPress: () =>
          undo
            .mutateAsync({ leagueId, matchId })
            .then(async () => {
              await refresh();
              AccessibilityInfo.announceForAccessibility("Score undone");
            })
            .catch(async (e) => {
              await refresh();
              const error = (e as { data?: { error?: string } | null }).data?.error;
              Alert.alert("Couldn't undo", error ?? "Check your connection and try again.");
            }),
      },
    ]);
  }

  return (
    <Pressable
      onPress={confirm}
      disabled={undo.isPending}
      accessibilityRole="button"
      accessibilityLabel="Undo score"
      accessibilityHint={`You can undo for ${countdownSpoken(left)} more`}
      accessibilityState={{ disabled: undo.isPending, busy: undo.isPending }}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        minWidth: MIN_TAP,
        justifyContent: "center",
        alignItems: align,
        opacity: pressed || undo.isPending ? 0.6 : 1,
      })}
    >
      <Text variant="button" style={{ textDecorationLine: "underline", fontVariant: ["tabular-nums"] }}>
        {`Undo · ${countdownLabel(left)}`}
      </Text>
    </Pressable>
  );
}
