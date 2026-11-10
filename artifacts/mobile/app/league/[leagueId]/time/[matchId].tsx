import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetLeagueScheduleQueryKey,
  getGetMyLeagueWeekQueryKey,
  useGetLeagueMembership,
  useGetLeagueSchedule,
  useSetLeagueMatchTime,
} from "@workspace/api-client-react";

import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors, useScheme } from "@/hooks/useColors";
import { addDays, deadlineDate, isMine, matchWhen, opponentName, pickableDays, shortDate, zonedTime } from "@/lib/leagueSchedule";
import { todaysMatchesKey } from "@/lib/recording/api";

// Match time (PR 4). In a league with no weekly match time, either player sets
// a date and time for their match inside its week; both see it, and either can
// change it. A time never gates recording: it only puts the match first on
// Home and the Ball Boi tab that day. Native iOS date and time picker in a
// bottom sheet (the sheet rule: no Cancel, drag down to close). Days already
// past in the round are greyed out and can't be picked (finding 10).

export default function MatchTimeScreen() {
  const c = useColors();
  const scheme = useScheme();
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
  const opponent = match ? (myPlayerId != null && isMine(match, myPlayerId) ? opponentName(match, myPlayerId) : null) : null;
  const title = match ? (opponent ? `You vs. ${opponent}` : `${match.player1Name} vs. ${match.player2Name}`) : null;

  // The match's week in the league's time zone; the grace week once the
  // deadline passes. Only today through the last day can be picked.
  const lastDay = round ? (round.phase === "grace" ? round.graceEnd : round.deadline) : null;
  const days = round && lastDay && scheduleQ.data ? pickableDays(round.startDate, lastDay, scheduleQ.data.today) : null;
  const min = days ? zonedTime(days.first, "00:00", timeZone) : undefined;
  const max = days ? new Date(zonedTime(addDays(days.last, 1), "00:00", timeZone).getTime() - 60_000) : undefined;

  const [value, setValue] = useState<Date | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSetLeagueMatchTime();
  const sheet = useSheetClose(touched && !save.isPending);

  // Start from the time already set, else 6 PM today, kept inside the days that can be picked.
  useEffect(() => {
    if (value || !min || !max) return;
    const set = match?.scheduledAt ? new Date(match.scheduledAt) : null;
    const start = set ?? new Date();
    if (!set) start.setHours(18, 0, 0, 0);
    const clamped = start < min ? new Date(min.getTime() + 18 * 3_600_000) : start > max ? new Date(max.getTime() - 6 * 3_600_000) : start;
    setValue(clamped < min ? min : clamped);
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
      sheet.finish();
    } catch (e) {
      const data = (e as { data?: { error?: string } | null }).data;
      setError(data?.error ?? "Couldn't save the time. Check your connection and try again.");
    }
  }

  return (
    <SheetBody title="Match time" close={sheet.close}>
      <View style={{ gap: spacing.space1 }}>
        {title ? <Text variant="title">{title}</Text> : null}
        {round && lastDay ? (
          <Text variant="small" tone="inkMuted">
            {`Round ${round.roundNumber} · ${shortDate(round.startDate)} to ${deadlineDate(lastDay, timeZone)}`}
          </Text>
        ) : null}
        <Text variant="small" tone="inkMuted">
          {days
            ? "Pick a day from today to the end of the round. You both see it on your match, and either of you can change it."
            : scheduleQ.isLoading
              ? "Loading your match."
              : scheduleQ.isError
                ? "Your match didn't load. Check your connection and try again."
                : !match
                  ? "This match isn't in the schedule anymore. It may have been cancelled."
                  : "This round is over, so there's no day left to pick."}
        </Text>
      </View>

      {scheduleQ.isError && !days ? (
        <Button label="Try again" variant="secondary" loading={scheduleQ.isRefetching} onPress={() => void scheduleQ.refetch()} />
      ) : null}

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
              setTouched(true);
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

      <Button label="Save time" onPress={onSave} disabled={!value || !match || !days} loading={save.isPending} />
    </SheetBody>
  );
}
