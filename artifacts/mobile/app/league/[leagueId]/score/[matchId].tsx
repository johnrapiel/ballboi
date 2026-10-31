import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetLeagueScheduleQueryKey,
  getGetLeagueStandingsQueryKey,
  getGetLeaguesQueryKey,
  useEnterLeagueScore,
  useGetLeagueMembership,
  useGetLeagueSchedule,
} from "@workspace/api-client-react";

import { Button, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { opponentName, shortDate } from "@/lib/leagueSchedule";
import { emptySet, isTiebreakSet, readScore, type SetEntry } from "@/lib/scoreEntry";

// Enter score (spec: Leagues > Scores and standings; canvas: Log result).
// Either player enters it, from their own side. The first score entered
// stands, so there's no edit afterwards: the sheet says so before you save.

function ScoreBox({
  value,
  onChange,
  label,
  size = 58,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  size?: number;
}) {
  const c = useColors();
  return (
    <TextInput
      value={value}
      onChangeText={(t) => onChange(t.replace(/[^0-9]/g, "").slice(0, 2))}
      keyboardType="number-pad"
      maxLength={2}
      accessibilityLabel={label}
      maxFontSizeMultiplier={1.5}
      textAlign="center"
      style={[
        type.score,
        {
          fontSize: size === 58 ? 30 : 24,
          lineHeight: undefined,
          minWidth: size,
          minHeight: Math.max(MIN_TAP, size),
          paddingHorizontal: spacing.space1,
          borderRadius: radius.radiusSm,
          borderWidth: 1,
          borderColor: c.hairlineStrong,
          backgroundColor: c.linen,
          color: c.ink,
        },
      ]}
    />
  );
}

export default function EnterScoreScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { leagueId: rawLeague, matchId: rawMatch } = useLocalSearchParams<{ leagueId: string; matchId: string }>();
  const leagueId = Number(rawLeague);
  const matchId = Number(rawMatch);

  const scheduleQ = useGetLeagueSchedule(leagueId);
  const membershipQ = useGetLeagueMembership(leagueId);
  const myPlayerId = membershipQ.data?.playerId ?? null;
  const round = scheduleQ.data?.rounds.find((r) => r.matches.some((m) => m.matchId === matchId));
  const match = round?.matches.find((m) => m.matchId === matchId);
  const opponent = match && myPlayerId != null ? opponentName(match, myPlayerId) : "your opponent";
  const opponentShort = opponent.split(" ")[0];

  const [sets, setSets] = useState<SetEntry[]>([emptySet(), emptySet(), emptySet()]);
  const [serverError, setServerError] = useState<string | null>(null);
  const draft = readScore(sets);
  const save = useEnterLeagueScore();

  const update = (i: number, patch: Partial<SetEntry>) => {
    setServerError(null);
    setSets((prev) => prev.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  };

  async function onSave() {
    if (!draft.ok) return;
    try {
      await save.mutateAsync({ leagueId, matchId, data: { score: draft.score } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) }),
        queryClient.invalidateQueries({ queryKey: getGetLeagueStandingsQueryKey(leagueId) }),
        queryClient.invalidateQueries({ queryKey: getGetLeaguesQueryKey().slice(0, 1) }),
      ]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Score saved");
      router.back();
    } catch (e) {
      const data = (e as { data?: { error?: string } | null }).data;
      setServerError(data?.error ?? "Couldn't save the score. Check your connection and try again.");
      // A score that's already in means someone else entered it first.
      void queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) });
    }
  }

  const summary = draft.ok
    ? `${draft.iWon ? "You won" : `${opponentShort} won`} ${draft.score}`
    : draft.message ?? "Enter the games for each set you played.";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.linen }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space6, gap: spacing.space4 }}
      keyboardShouldPersistTaps="handled"
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
          Enter score
        </Text>
        <View style={{ minWidth: MIN_TAP }} />
      </View>

      <View style={{ gap: spacing.space1 }}>
        {round ? (
          <Text variant="label" tone="inkMuted">
            {`Round ${round.roundNumber} · Play by ${shortDate(round.deadline)}`}
          </Text>
        ) : null}
        <Text variant="title">{`You vs. ${opponent}`}</Text>
        {round?.phase === "grace" ? (
          <Text variant="small" tone="inkMuted">
            This is the grace week, so this score counts for Ball Boi stats, not standings.
          </Text>
        ) : null}
      </View>

      <View style={{ gap: spacing.space2 }}>
        <Text variant="small" tone="inkMuted">
          Your games first. Leave set 3 empty if you won in two.
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-end" }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={{ flex: 1 }} />
          {[1, 2, 3].map((n) => (
            <Text key={n} variant="label" tone="inkMuted" style={{ minWidth: 58, textAlign: "center" }}>
              {`Set ${n}`}
            </Text>
          ))}
        </View>
        {(["me", "them"] as const).map((side) => (
          <View key={side} style={{ flexDirection: "row", gap: spacing.space2, alignItems: "center" }}>
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
              {side === "me" ? "You" : opponent}
            </Text>
            {sets.map((s, i) => (
              <ScoreBox
                key={i}
                value={s[side]}
                onChange={(v) => update(i, { [side]: v })}
                label={`Set ${i + 1}, ${side === "me" ? "your games" : `${opponent}'s games`}`}
              />
            ))}
          </View>
        ))}
      </View>

      {sets.map((s, i) =>
        isTiebreakSet(s) ? (
          <View
            key={`tb${i}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.space3,
              padding: spacing.space3,
              borderRadius: radius.radiusMd,
              backgroundColor: c.sand,
            }}
          >
            <Text variant="label" style={{ flex: 1 }}>
              {`Set ${i + 1} tiebreak (optional)`}
            </Text>
            <ScoreBox size={48} value={s.tbMe} onChange={(v) => update(i, { tbMe: v })} label={`Set ${i + 1} tiebreak, your points`} />
            <Text tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
              –
            </Text>
            <ScoreBox size={48} value={s.tbThem} onChange={(v) => update(i, { tbThem: v })} label={`Set ${i + 1} tiebreak, ${opponent}'s points`} />
          </View>
        ) : null,
      )}

      <View
        accessibilityLiveRegion="polite"
        style={{ padding: spacing.space3, borderRadius: radius.radiusMd, borderWidth: 1, borderColor: c.hairline, gap: spacing.space1 }}
      >
        <Text variant="bodyStrong">{summary}</Text>
        {serverError ? (
          <Text variant="small" tone="danger">
            {`Not saved. ${serverError}`}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: spacing.space2 }}>
        <Button
          label="Save score"
          onPress={() => void onSave()}
          disabled={!draft.ok || !match}
          loading={save.isPending}
          accessibilityHint="The first score entered stands and can't be changed"
        />
        <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
          The first score entered stands, so check it before you save.
        </Text>
      </View>
    </ScrollView>
  );
}
