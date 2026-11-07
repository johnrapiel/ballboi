import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, View } from "react-native";
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

import { ScoreGrid, ScoreResult } from "@/components/league/ScoreGrid";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Card, Text, TextButton } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { correctionLine, deadlineDate, opponentName } from "@/lib/leagueSchedule";
import { refreshLeague } from "@/lib/leagueRefresh";
import { ROUND_SINGULAR } from "@/components/league/Bracket";
import { emptySet, readScore, setRowsToShow, setsFromScore, type SetEntry } from "@/lib/scoreEntry";
import { scoreNote } from "@/lib/playoffView";

// Enter score (spec: Leagues > Scores and standings; approved canvas: Enter
// score, a bottom sheet with no Cancel: drag down to close, and it asks before
// discarding typed scores). Either player enters it, from their own side.
// Only real tennis scores save (C10): the third set opens only at one set all,
// and a set typed 6-6 asks for its tiebreak (finding 5). "Opponent retired" saves
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

/** Drops the third set's boxes whenever the sheet no longer shows them. */
function keepShownSets(sets: SetEntry[]): SetEntry[] {
  return setRowsToShow(sets) === 3 ? sets : sets.map((s, i) => (i === 2 ? emptySet() : s));
}


export default function EnterScoreScreen() {
  const c = useColors();
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
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const draft = readScore(sets, { retired: retired && !asAdmin });
  const rows = setRowsToShow(sets);
  const save = useEnterLeagueScore();
  const fix = useCorrectLeagueScore();
  const result = useSettlePlayoffMatch();
  const busy = save.isPending || fix.isPending || result.isPending;
  // The bottom sheet rule: closing asks before it discards typed scores.
  const sheet = useSheetClose(touched && !busy);

  // Correcting starts from the score as it stands.
  useEffect(() => {
    if (correcting && !prefilled && currentScore) {
      setSets(keepShownSets(setsFromScore(currentScore, 3)));
      setPrefilled(true);
    }
  }, [correcting, prefilled, currentScore]);

  const update = (i: number, patch: Partial<SetEntry>) => {
    setServerError(null);
    setTouched(true);
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
      sheet.finish();
    } catch (e) {
      const data = (e as { data?: { error?: string } | null }).data;
      setServerError(data?.error ?? "Couldn't save the score. Check your connection and try again.");
      // A score that's already in means someone else entered it first.
      void queryClient.invalidateQueries({ queryKey: getGetLeagueScheduleQueryKey(leagueId) });
    }
  }

  // Q6: the opponent stopped mid-match. A quiet link, since it's the one case
  // the score can't decide. Not for admin corrections.
  function matchDidntFinish() {
    Alert.alert(
      "Match didn't finish?",
      "If your opponent couldn't continue, enter the games played so far. It counts as your win and shows RET.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "My opponent retired",
          onPress: () => {
            setServerError(null);
            setTouched(true);
            setRetired(true);
            AccessibilityInfo.announceForAccessibility("Opponent retired. Enter the games played so far.");
          },
        },
      ],
    );
  }

  const title = correcting ? "Correct score" : settling ? "Enter result" : "Enter score";
  const loading = scheduleQ.isLoading || bracketQ.isLoading || leagueQ.isLoading;
  const loadFailed = scheduleQ.isError || bracketQ.isError || leagueQ.isError;
  // C25: offline or the request failed, and we don't have the match to show.
  if (!match) {
    return (
      <SheetBody title={title} close={sheet.close}>
        {loading ? (
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading match" />
        ) : (
          <Card style={{ gap: spacing.space3 }}>
            <Text variant="bodyStrong">Couldn't load this match</Text>
            <Text variant="small" tone="inkMuted">
              {loadFailed ? "Check your connection and try again." : "It may have been cancelled. Try again, or go back to the league."}
            </Text>
            <Button
              label="Try again"
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
      </SheetBody>
    );
  }

  const closedNote = ended
    ? "This league has ended, so its scores are final."
    : pastPlayBy && playoffRound?.playBy
      ? `The play-by date for this match was ${deadlineDate(playoffRound.playBy, scheduleQ.data?.timeZone)}. Your league admin can enter the result.`
      : null;
  const canSave = draft.ok && !closedNote;
  const note = scoreNote({ correcting, settling, playoffRound: playoffSlot?.round ?? null });
  const leagueName = leagueQ.data?.name;
  const meta = [
    leagueName,
    round ? `Round ${round.roundNumber}` : playoffSlot ? `Playoffs · ${ROUND_SINGULAR[playoffSlot.round]}` : null,
    !asAdmin && round && !correcting
      ? `Play by ${deadlineDate(round.deadline, scheduleQ.data?.timeZone)}`
      : !asAdmin && playoffRound?.playBy && !playoffRound.pastPlayBy
        ? `Play by ${deadlineDate(playoffRound.playBy, scheduleQ.data?.timeZone)}`
        : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const winnerLine = draft.ok ? (draft.iWon ? (asAdmin ? `${firstShort} wins` : "You win") : `${opponentShort} wins`) : "";
  const prompt = retired
    ? "Enter the games played before your opponent retired."
    : asAdmin
      ? `${firstShort}'s games on top. The third set opens if they split the first two.`
      : "Your games on top. The third set opens if you split the first two.";

  return (
    <SheetBody title={title} close={sheet.close}>
      <View style={{ gap: spacing.space1 }}>
        <Text variant="title">{`${firstName} vs. ${opponent}`}</Text>
        {meta ? (
          <Text variant="small" tone="inkMuted">
            {meta}
          </Text>
        ) : null}
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
          <ScoreGrid
            sets={sets}
            onChange={update}
            firstName={asAdmin ? firstShort : "You"}
            secondName={opponentShort}
            activeSets={rows}
            firstPossessive={asAdmin ? `${firstName}'s` : "your"}
            secondPossessive={`${opponent}'s`}
          />

          <ScoreResult draft={draft} winner={winnerLine} prompt={prompt} error={serverError} />

          {asAdmin ? null : retired ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
              <Text variant="small" tone="inkMuted" style={{ flexShrink: 1 }}>
                Opponent retired: it counts as your win and shows RET.
              </Text>
              <TextButton
                label="Undo"
                accessibilityLabel="Undo opponent retired"
                style={{ alignSelf: "flex-start", paddingHorizontal: 0 }}
                onPress={() => {
                  setServerError(null);
                  setRetired(false);
                }}
              />
            </View>
          ) : (
            <TextButton
              label="Match didn't finish?"
              accessibilityHint="For when your opponent couldn't continue"
              style={{ alignSelf: "flex-start", paddingHorizontal: 0 }}
              onPress={matchDidntFinish}
            />
          )}
        </>
      )}

      <Button
        label={correcting ? "Correct score" : settling ? "Enter result" : "Save score"}
        onPress={onSave}
        disabled={!canSave}
        loading={busy}
        accessibilityHint={asAdmin ? "Asks you to confirm" : note.hint}
      />
    </SheetBody>
  );
}
