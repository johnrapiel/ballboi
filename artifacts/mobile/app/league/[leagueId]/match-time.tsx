import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetLeagueQueryKey,
  getGetLeagueScheduleQueryKey,
  getGetMyLeagueWeekQueryKey,
  useGetLeague,
  useSetLeagueWeeklyMatchTime,
} from "@workspace/api-client-react";

import { MatchTimeFields, hhmm, timeFromHHMM } from "@/components/league/MatchTimeFields";
import { Button, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { zoneSuffix } from "@/lib/leagueSchedule";

// Manage > Match time (PR 4). An admin sets one weekly match day and time for
// a club league, or turns it off so players pick. Pairings still in review
// pick it up; rounds already out keep the times they have.

export default function LeagueMatchTimeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);
  const leagueQ = useGetLeague(leagueId);
  const league = leagueQ.data;
  const save = useSetLeagueWeeklyMatchTime();

  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [day, setDay] = useState(2);
  const [time, setTime] = useState<Date>(() => timeFromHHMM(null));
  const [error, setError] = useState<string | null>(null);

  // Start from what the league has now.
  useEffect(() => {
    if (loaded || !league) return;
    setEnabled(league.matchDay != null && !!league.matchTime);
    if (league.matchDay != null) setDay(league.matchDay);
    if (league.matchTime) setTime(timeFromHHMM(league.matchTime));
    else if (league.startDate) setDay(new Date(`${league.startDate}T12:00:00Z`).getUTCDay());
    setLoaded(true);
  }, [loaded, league]);

  async function onSave() {
    if (save.isPending) return;
    setError(null);
    try {
      await save.mutateAsync({
        leagueId,
        data: enabled ? { matchDay: day, matchTime: hhmm(time) } : { matchDay: null, matchTime: null },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetLeagueQueryKey(leagueId) }),
        queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) }),
        queryClient.invalidateQueries({ queryKey: getGetMyLeagueWeekQueryKey() }),
      ]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Match time saved");
      router.back();
    } catch (e) {
      const data = (e as { data?: { error?: string } | null }).data;
      setError(data?.error ?? "Couldn't save the match time. Check your connection and try again.");
    }
  }

  const zone = zoneSuffix(league?.timeZone).trim();

  return (
    <ScrollView
      style={{ backgroundColor: c.linen }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space6, gap: spacing.space4 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={({ pressed }) => ({ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="body">Cancel</Text>
        </Pressable>
        <Text variant="bodyStrong" accessibilityRole="header">
          Match time
        </Text>
        <View style={{ minWidth: MIN_TAP }} />
      </View>

      <MatchTimeFields enabled={enabled} onEnabledChange={setEnabled} day={day} onDayChange={setDay} time={time} onTimeChange={setTime} />

      <Text variant="small" tone="inkMuted">
        {`Applies from the next round. Matches already out keep their times.${zone ? ` Times are in the league's time zone (${zone}).` : ""}`}
      </Text>

      {error ? (
        <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
          {`Not saved. ${error}`}
        </Text>
      ) : null}

      <Button label="Save" onPress={onSave} disabled={!league} loading={save.isPending} />
    </ScrollView>
  );
}
