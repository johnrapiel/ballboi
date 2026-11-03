import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetLeagueScheduleQueryKey,
  getGetLeagueStandingsQueryKey,
  getGetLeaguesQueryKey,
  useCorrectLeagueScore,
  useEnterLeagueScore,
  getGetLeagueBracketQueryKey,
  useGetLeagueBracket,
  useGetLeagueMembership,
  useGetLeagueSchedule,
} from "@workspace/api-client-react";

import { Button, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { correctionLine, opponentName, shortDate } from "@/lib/leagueSchedule";
import { ROUND_SINGULAR } from "@/components/league/Bracket";
import { emptySet, isTiebreakSet, readScore, setsFromScore, type SetEntry } from "@/lib/scoreEntry";

// Enter score (spec: Leagues > Scores and standings; canvas: Log result).
// Either player enters it, from their own side. The player who entered it can
// undo it for 10 minutes (C4); after that the first score stands.
//
// With ?correct=1 it's the admin's correction from Manage (C5): the boxes
// start with the score as it stands, from player 1's side, and saving asks
// to confirm. The match then shows "Corrected by {admin} on {date}".

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
  const { leagueId: rawLeague, matchId: rawMatch, correct } = useLocalSearchParams<{ leagueId: string; matchId: string; correct?: string }>();
  const leagueId = Number(rawLeague);
  const matchId = Number(rawMatch);
  const correcting = correct === "1";

  const scheduleQ = useGetLeagueSchedule(leagueId);
  const membershipQ = useGetLeagueMembership(leagueId);
  const myPlayerId = membershipQ.data?.playerId ?? null;
  const bracketQ = useGetLeagueBracket(leagueId);
  const round = scheduleQ.data?.rounds.find((r) => r.matches.some((m) => m.matchId === matchId));
  const weekly = round?.matches.find((m) => m.matchId === matchId);
  const playoffSlot = bracketQ.data?.rounds.flatMap((r) => r.slots).find((s) => s.matchId === matchId);
  const playoffOpponent = playoffSlot
    ? playoffSlot.player1?.playerId === myPlayerId
      ? playoffSlot.player2?.playerName
      : playoffSlot.player1?.playerName
    : undefined;
  const match = weekly ?? (playoffSlot ? { matchId } : undefined);
  const opponent = correcting
    ? weekly?.player2Name ?? "Player 2"
    : weekly && myPlayerId != null
      ? opponentName(weekly, myPlayerId)
      : playoffOpponent ?? "your opponent";
  const opponentShort = opponent.split(" ")[0];
  // Correcting: the first row is player 1, the second player 2.
  const firstName = correcting ? weekly?.player1Name ?? "Player 1" : "You";
  const firstShort = firstName.split(" ")[0];

  const [sets, setSets] = useState<SetEntry[]>([emptySet(), emptySet(), emptySet()]);
  const [prefilled, setPrefilled] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const draft = readScore(sets);
  const save = useEnterLeagueScore();
  const fix = useCorrectLeagueScore();
  const busy = save.isPending || fix.isPending;

  // Correcting starts from the score as it stands.
  useEffect(() => {
    if (correcting && !prefilled && weekly?.score) {
      setSets(setsFromScore(weekly.score, 3));
      setPrefilled(true);
    }
  }, [correcting, prefilled, weekly?.score]);

  const update = (i: number, patch: Partial<SetEntry>) => {
    setServerError(null);
    setSets((prev) => prev.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  };

  function onSave() {
    if (!draft.ok || busy) return;
    if (!correcting) {
      void submit();
      return;
    }
    const winner = draft.iWon ? firstName : opponent;
    Alert.alert(
      "Correct this score?",
      `${winner} won ${draft.score}. Standings update, and both players see that you corrected it.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Correct score", onPress: () => void submit() },
      ],
    );
  }

  async function submit() {
    if (!draft.ok) return;
    try {
      if (correcting) await fix.mutateAsync({ leagueId, matchId, data: { score: draft.score } });
      else await save.mutateAsync({ leagueId, matchId, data: { score: draft.score } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) }),
        queryClient.invalidateQueries({ queryKey: getGetLeagueBracketQueryKey(leagueId) }),
        queryClient.invalidateQueries({ queryKey: getGetLeagueStandingsQueryKey(leagueId) }),
        queryClient.invalidateQueries({ queryKey: getGetLeaguesQueryKey().slice(0, 1) }),
      ]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(correcting ? "Score corrected" : "Score saved");
      router.back();
    } catch (e) {
      const data = (e as { data?: { error?: string } | null }).data;
      setServerError(data?.error ?? "Couldn't save the score. Check your connection and try again.");
      // A score that's already in means someone else entered it first.
      void queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) });
    }
  }

  const summary = draft.ok
    ? `${draft.iWon ? (correcting ? `${firstShort} won` : "You won") : `${opponentShort} won`} ${draft.score}`
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
          {correcting ? "Correct score" : "Enter score"}
        </Text>
        <View style={{ minWidth: MIN_TAP }} />
      </View>

      <View style={{ gap: spacing.space1 }}>
        {round ? (
          <Text variant="label" tone="inkMuted">
            {correcting ? `Round ${round.roundNumber}` : `Round ${round.roundNumber} · Play by ${shortDate(round.deadline)}`}
          </Text>
        ) : playoffSlot ? (
          <Text variant="label" tone="inkMuted">
            {`Playoffs · ${ROUND_SINGULAR[playoffSlot.round]}`}
          </Text>
        ) : null}
        <Text variant="title">{correcting ? `${firstName} vs. ${opponent}` : `You vs. ${opponent}`}</Text>
        {correcting && weekly ? (
          <Text variant="small" tone="inkMuted">
            {[`Now: ${weekly.score ? weekly.score : "no score"}`, correctionLine(weekly)].filter(Boolean).join(". ")}
          </Text>
        ) : null}
        {!correcting && round?.phase === "grace" ? (
          <Text variant="small" tone="inkMuted">
            This is the grace week, so this score counts for Ball Boi stats, not standings.
          </Text>
        ) : null}
      </View>

      <View style={{ gap: spacing.space2 }}>
        <Text variant="small" tone="inkMuted">
          {correcting
            ? `${firstShort}'s games on top. Leave set 3 empty if the match was two sets.`
            : "Your games first. Leave set 3 empty if you won in two."}
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
              {side === "me" ? firstName : opponent}
            </Text>
            {sets.map((s, i) => (
              <ScoreBox
                key={i}
                value={s[side]}
                onChange={(v) => update(i, { [side]: v })}
                label={`Set ${i + 1}, ${side === "me" ? (correcting ? `${firstName}'s games` : "your games") : `${opponent}'s games`}`}
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
            <ScoreBox
              size={48}
              value={s.tbMe}
              onChange={(v) => update(i, { tbMe: v })}
              label={`Set ${i + 1} tiebreak, ${correcting ? `${firstName}'s` : "your"} points`}
            />
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
          label={correcting ? "Correct score" : "Save score"}
          onPress={onSave}
          disabled={!draft.ok || !match}
          loading={busy}
          accessibilityHint={correcting ? "Asks you to confirm, then updates standings" : "You can undo it for 10 minutes"}
        />
        <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
          {correcting
            ? "Players can't change a score. Only league admins can correct one."
            : "You can undo for 10 minutes after you save. After that, the score stands."}
        </Text>
      </View>
    </ScrollView>
  );
}
