import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetLeagueScheduleQueryKey,
  useCorrectLeagueScore,
  useEnterLeagueScore,
  useGetLeague,
  useGetLeagueBracket,
  useGetLeagueMembership,
  useGetLeagueSchedule,
  useSettlePlayoffMatch,
} from "@workspace/api-client-react";

import { Button, Card, Text } from "@/components/ui";
import { Toggle } from "@/components/Toggle";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { correctionLine, deadlineDate, opponentName } from "@/lib/leagueSchedule";
import { refreshLeague } from "@/lib/leagueRefresh";
import { ROUND_SINGULAR } from "@/components/league/Bracket";
import { emptySet, isTiebreakSet, readScore, setRowsToShow, setsFromScore, type SetEntry } from "@/lib/scoreEntry";
import { scoreNote } from "@/lib/playoffView";

// Enter score (spec: Leagues > Scores and standings; canvas: Log result).
// Either player enters it, from their own side. Only real tennis scores save
// (C10): the third set shows only at one set all. "Opponent retired" saves
// the sets so far as your win, shown as RET (Q6). A weekly score can be undone
// for 10 minutes (C4); a playoff score moves the winner on, and only the
// admin can change it (C9).
//
// With ?correct=1 it's the admin's correction from Manage (C5): the boxes
// start with the score as it stands, from player 1's side, and saving asks
// to confirm. The match then shows "Corrected by {admin} on {date}".
//
// With ?settle=1 it's the admin entering the result of a playoff match after
// its play-by date (Q5b), from player 1's side.

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

/** Drops the third set's boxes whenever the sheet no longer shows them. */
function keepShownSets(sets: SetEntry[]): SetEntry[] {
  return setRowsToShow(sets) === 3 ? sets : sets.map((s, i) => (i === 2 ? emptySet() : s));
}

export default function EnterScoreScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { leagueId: rawLeague, matchId: rawMatch, correct, settle } = useLocalSearchParams<{
    leagueId: string;
    matchId: string;
    correct?: string;
    settle?: string;
  }>();
  const leagueId = Number(rawLeague);
  const matchId = Number(rawMatch);
  const correcting = correct === "1";
  const settling = settle === "1" && !correcting;
  // Admins enter corrections and results from player 1's side.
  const asAdmin = correcting || settling;

  const leagueQ = useGetLeague(leagueId);
  const scheduleQ = useGetLeagueSchedule(leagueId);
  const membershipQ = useGetLeagueMembership(leagueId);
  const myPlayerId = membershipQ.data?.playerId ?? null;
  const bracketQ = useGetLeagueBracket(leagueId);
  const round = scheduleQ.data?.rounds.find((r) => r.matches.some((m) => m.matchId === matchId));
  const weekly = round?.matches.find((m) => m.matchId === matchId);
  const playoffRound = bracketQ.data?.rounds.find((r) => r.slots.some((s) => s.matchId === matchId));
  const playoffSlot = playoffRound?.slots.find((s) => s.matchId === matchId);
  const playoffOpponent = playoffSlot
    ? playoffSlot.player1?.playerId === myPlayerId
      ? playoffSlot.player2?.playerName
      : playoffSlot.player1?.playerName
    : undefined;
  const match = weekly ?? (playoffSlot ? { matchId } : undefined);
  const ended = !!leagueQ.data?.endedAt || leagueQ.data?.status === "completed";
  // Q5b: after a playoff round's play-by date, the admin enters the result.
  const pastPlayBy = !asAdmin && !!playoffRound?.pastPlayBy;
  const opponent = asAdmin
    ? weekly?.player2Name ?? playoffSlot?.player2?.playerName ?? "Player 2"
    : weekly && myPlayerId != null
      ? opponentName(weekly, myPlayerId)
      : playoffOpponent ?? "your opponent";
  const opponentShort = opponent.split(" ")[0];
  // Admin: the first row is player 1, the second player 2.
  const firstName = asAdmin ? weekly?.player1Name ?? playoffSlot?.player1?.playerName ?? "Player 1" : "You";
  const currentScore = weekly?.score ?? playoffSlot?.score ?? null;
  const firstShort = firstName.split(" ")[0];

  const [sets, setSets] = useState<SetEntry[]>([emptySet(), emptySet(), emptySet()]);
  const [retired, setRetired] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const draft = readScore(sets, { retired: retired && !asAdmin });
  const rows = setRowsToShow(sets);
  const save = useEnterLeagueScore();
  const fix = useCorrectLeagueScore();
  const result = useSettlePlayoffMatch();
  const busy = save.isPending || fix.isPending || result.isPending;

  // Correcting starts from the score as it stands.
  useEffect(() => {
    if (correcting && !prefilled && currentScore) {
      setSets(keepShownSets(setsFromScore(currentScore, 3)));
      setPrefilled(true);
    }
  }, [correcting, prefilled, currentScore]);

  const update = (i: number, patch: Partial<SetEntry>) => {
    setServerError(null);
    setSets((prev) => keepShownSets(prev.map((s, n) => (n === i ? { ...s, ...patch } : s))));
  };

  function onSave() {
    if (!draft.ok || busy) return;
    if (!asAdmin) {
      void submit();
      return;
    }
    const winner = draft.iWon ? firstName : opponent;
    if (settling) {
      Alert.alert("Enter this result?", `${winner} won ${draft.score} and moves on in the playoffs. Both players are told.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Enter result", onPress: () => void submit() },
      ]);
      return;
    }
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
      else if (settling) await result.mutateAsync({ leagueId, matchId, data: { score: draft.score } });
      else await save.mutateAsync({ leagueId, matchId, data: { score: draft.score, ...(retired ? { retired: true } : {}) } });
      await refreshLeague(queryClient, leagueId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(correcting ? "Score corrected" : settling ? "Result entered" : "Score saved");
      router.back();
    } catch (e) {
      const data = (e as { data?: { error?: string } | null }).data;
      setServerError(data?.error ?? "Couldn't save the score. Check your connection and try again.");
      // A score that's already in means someone else entered it first.
      void queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) });
    }
  }

  const summary = draft.ok
    ? `${draft.iWon ? (asAdmin ? `${firstShort} won` : "You won") : `${opponentShort} won`} ${draft.score}`
    : draft.message ?? (retired ? "Enter the games played before your opponent retired." : "Enter the games for each set you played.");

  const header = (
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
  );

  const loading = scheduleQ.isLoading || bracketQ.isLoading || leagueQ.isLoading;
  const loadFailed = scheduleQ.isError || bracketQ.isError || leagueQ.isError;
  // C25: offline or the request failed, and we don't have the match to show.
  if (!match) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: c.linen }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space6, gap: spacing.space4 }}
      >
        {header}
        {loading ? (
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading match" />
        ) : (
          <Card style={{ gap: spacing.space3 }}>
            <Text variant="bodyStrong">Couldn't load this match</Text>
            <Text variant="small" tone="inkMuted">
              {loadFailed ? "Check your connection and try again." : "It may have been cancelled. Try again, or go back to the league."}
            </Text>
            <Button
              label="Retry"
              variant="secondary"
              onPress={() => {
                void leagueQ.refetch();
                void scheduleQ.refetch();
                void bracketQ.refetch();
                void membershipQ.refetch();
              }}
            />
          </Card>
        )}
      </ScrollView>
    );
  }

  const closedNote = ended
    ? "This league has ended, so its scores are final."
    : pastPlayBy && playoffRound?.playBy
      ? `The play-by date for this match was ${deadlineDate(playoffRound.playBy, scheduleQ.data?.timeZone)}. Your league admin can enter the result.`
      : null;
  const canSave = draft.ok && !closedNote;
  const note = scoreNote({ correcting, settling, playoffRound: playoffSlot?.round ?? null });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.linen }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space6, gap: spacing.space4 }}
      keyboardShouldPersistTaps="handled"
    >
      {header}

      <View style={{ gap: spacing.space1 }}>
        {round ? (
          <Text variant="label" tone="inkMuted">
            {correcting ? `Round ${round.roundNumber}` : `Round ${round.roundNumber} · Play by ${deadlineDate(round.deadline, scheduleQ.data?.timeZone)}`}
          </Text>
        ) : playoffSlot ? (
          <Text variant="label" tone="inkMuted">
            {[
              `Playoffs · ${ROUND_SINGULAR[playoffSlot.round]}`,
              !asAdmin && playoffRound?.playBy && !playoffRound.pastPlayBy
                ? `Play by ${deadlineDate(playoffRound.playBy, scheduleQ.data?.timeZone)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
        <Text variant="title">{asAdmin ? `${firstName} vs. ${opponent}` : `You vs. ${opponent}`}</Text>
        {correcting ? (
          <Text variant="small" tone="inkMuted">
            {[
              `Now: ${currentScore ?? "no score"}`,
              weekly ? correctionLine(weekly) : null,
              playoffSlot ? "Allowed until the next playoff round is played. The corrected winner takes that spot." : null,
            ]
              .filter(Boolean)
              .join(". ")}
          </Text>
        ) : null}
        {!asAdmin && round?.phase === "grace" ? (
          <Text variant="small" tone="inkMuted">
            This is the grace week, so this score counts for Ball Boi stats, not standings.
          </Text>
        ) : null}
      </View>

      {closedNote ? (
        <Card>
          <Text variant="bodyStrong">{closedNote}</Text>
        </Card>
      ) : (
        <>
          <View style={{ gap: spacing.space2 }}>
            <Text variant="small" tone="inkMuted">
              {asAdmin
                ? `${firstShort}'s games on top. A third set shows if they split the first two.`
                : retired
                  ? "Your games first: the sets so far, and the games in the set you were playing."
                  : "Your games first. A third set shows if you split the first two."}
            </Text>
            <View style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-end" }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <View style={{ flex: 1 }} />
              {sets.slice(0, rows).map((_, i) => (
                <Text key={i} variant="label" tone="inkMuted" style={{ minWidth: 58, textAlign: "center" }}>
                  {`Set ${i + 1}`}
                </Text>
              ))}
            </View>
            {(["me", "them"] as const).map((side) => (
              <View key={side} style={{ flexDirection: "row", gap: spacing.space2, alignItems: "center" }}>
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                  {side === "me" ? firstName : opponent}
                </Text>
                {sets.slice(0, rows).map((s, i) => (
                  <ScoreBox
                    key={i}
                    value={s[side]}
                    onChange={(v) => update(i, { [side]: v })}
                    label={`Set ${i + 1}, ${side === "me" ? (asAdmin ? `${firstName}'s games` : "your games") : `${opponent}'s games`}`}
                  />
                ))}
              </View>
            ))}
            {rows === 3 ? (
              <Text variant="small" tone="inkMuted">
                Set 3 can be a match tiebreak, like 10-7.
              </Text>
            ) : null}
          </View>

          {sets.slice(0, rows).map((s, i) =>
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
                  label={`Set ${i + 1} tiebreak, ${asAdmin ? `${firstName}'s` : "your"} points`}
                />
                <Text tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
                  –
                </Text>
                <ScoreBox size={48} value={s.tbThem} onChange={(v) => update(i, { tbThem: v })} label={`Set ${i + 1} tiebreak, ${opponent}'s points`} />
              </View>
            ) : null,
          )}

          {/* Q6: the opponent stopped mid-match. Not for admin corrections. */}
          {!asAdmin ? (
            <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">Opponent retired</Text>
                <Text variant="small" tone="inkMuted">
                  {retired ? "It counts as your win and shows RET." : "They stopped before the match was over."}
                </Text>
              </View>
              <Toggle
                value={retired}
                onValueChange={(on) => {
                  setServerError(null);
                  setRetired(on);
                }}
                accessibilityLabel="Opponent retired"
              />
            </Card>
          ) : null}

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
        </>
      )}

      <View style={{ gap: spacing.space2 }}>
        <Button
          label={correcting ? "Correct score" : settling ? "Enter result" : "Save score"}
          onPress={onSave}
          disabled={!canSave}
          loading={busy}
          accessibilityHint={asAdmin ? "Asks you to confirm" : note.hint}
        />
        {!closedNote ? (
          <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
            {note.text}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
