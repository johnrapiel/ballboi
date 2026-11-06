import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetLeagueScheduleQueryKey,
  getGetMyLeagueWeekQueryKey,
  useGetLeagueMembership,
  useGetLeagueSchedule,
  useSetLeagueMatchTime,
} from "@workspace/api-client-react";

import { Button, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { addDays, deadlineDate, isMine, matchTitle, matchWhen, opponentName, shortDate, zonedTime } from "@/lib/leagueSchedule";
import { todaysMatchesKey } from "@/lib/recording/api";

// Match time (PR 4). In a league with no weekly match time, either player sets
// a date and time for their match inside its week; both see it, and either can
// change it. A time never gates recording: it only puts the match first on
// Home and the Ball Boi tab that day. Native iOS date and time picker in a sheet.

export default function MatchTimeScreen() {
  const c = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { leagueId: rawLeague, matchId: rawMatch } = useLocalSearchParams<{ leagueId: string; matchId: string }>();
  const leagueId = Number(rawLeague);
  const matchId = Number(rawMatch);

  const scheduleQ = useGetLeagueSchedule(leagueId);
  const membershipQ = useGetLeagueMembership(leagueId);
  const myPlayerId = membershipQ.data?.playerId ?? null;
  const timeZone = scheduleQ.data?.timeZone ?? "America/New_York";
  const round = scheduleQ.data?.rounds.find((r) => r.matches.some((m) => m.matchId === matchId));
  const match = round?.matches.find((m) => m.matchId === matchId);
  const opponent = match && myPlayerId != null && isMine(match, myPlayerId) ? opponentName(match, myPlayerId) : null;
  const title = match ? (opponent ? `You vs. ${opponent}` : matchTitle(match)) : "Match time";

  // The match's week in the league's time zone; the grace week once the deadline passes.
  const lastDay = round ? (round.phase === "grace" ? round.graceEnd : round.deadline) : null;
  const min = round ? zonedTime(round.startDate, "00:00", timeZone) : undefined;
  const max = lastDay ? new Date(zonedTime(addDays(lastDay, 1), "00:00", timeZone).getTime() - 60_000) : undefined;

  const [value, setValue] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useSetLeagueMatchTime();

  // Start from the time already set, else 6 PM today, kept inside the week.
  useEffect(() => {
    if (value || !min || !max) return;
    if (match?.scheduledAt) {
      setValue(new Date(match.scheduledAt));
      return;
    }
    const start = new Date();
    start.setHours(18, 0, 0, 0);
    const clamped = start < min ? new Date(min.getTime() + 18 * 3_600_000) : start > max ? new Date(max.getTime() - 6 * 3_600_000) : start;
    setValue(clamped);
  }, [value, min, max, match?.scheduledAt]);

  async function onSave() {
    if (!value || save.isPending) return;
    setError(null);
    try {
      await save.mutateAsync({ leagueId, matchId, data: { scheduledAt: value.toISOString() } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) }),
        queryClient.invalidateQueries({ queryKey: getGetMyLeagueWeekQueryKey() }),
        queryClient.invalidateQueries({ queryKey: todaysMatchesKey }),
      ]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(`Match time saved, ${matchWhen(value.toISOString())}`);
      router.back();
    } catch (e) {
      const data = (e as { data?: { error?: string } | null }).data;
      setError(data?.error ?? "Couldn't save the time. Check your connection and try again.");
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.linen }}
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

      <View style={{ gap: spacing.space1 }}>
        {round && lastDay ? (
          <Text variant="label" tone="inkMuted">
            {`Round ${round.roundNumber} · ${shortDate(round.startDate)} to ${deadlineDate(lastDay, timeZone)}`}
          </Text>
        ) : null}
        <Text variant="title">{title}</Text>
        <Text variant="small" tone="inkMuted">
          Pick a day this week. You both see it on your match, and either of you can change it.
        </Text>
      </View>

      {value && min && max ? (
        <DateTimePicker
          value={value}
          mode="datetime"
          display="inline"
          minimumDate={min}
          maximumDate={max}
          minuteInterval={5}
          themeVariant={scheme === "dark" ? "dark" : "light"}
          accentColor={c.court}
          accessibilityLabel="Match date and time"
          onChange={(_: DateTimePickerEvent, date?: Date) => {
            if (date) {
              setError(null);
              setValue(date);
            }
          }}
        />
      ) : null}

      {error ? (
        <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
          {`Not saved. ${error}`}
        </Text>
      ) : null}

      <Button label="Save time" onPress={onSave} disabled={!value || !match} loading={save.isPending} />
    </ScrollView>
  );
}
