// Post-stop score prompt (spec: Ball Boi > After the match): "Score prompt at
// stop posts to standings right away (ratings and stats only if the match is
// in its grace period)." Under it, the
// recording's processing card, so it's clear the match is saved.
//
// C23: the same sets and boxes as league score entry (best of three, real set
// scores, the third set only at one set all, a 6-6 set asks for its
// tiebreak), and a league match mentions the 24-hour edit (finding 7). Saving
// refreshes the league's standings, round and Home. A bottom sheet: no
// Cancel or Not now, drag down to close (asks first if scores were typed).

import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useState } from "react";
import { AccessibilityInfo, View } from "react-native";

import { getGetLeagueScheduleQueryKey, getGetMyLeagueWeekQueryKey, useGetLeagueSchedule } from "@workspace/api-client-react";

import { ScoreGrid, ScoreResult, displayScore } from "@/components/league/ScoreGrid";
import { LocalProcessingCard } from "@/components/record/ProcessingCard";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { recordingsKey, submitScore, todaysMatchesKey } from "@/lib/recording/api";
import { refreshLeague } from "@/lib/leagueRefresh";
import { emptySet, readScore, setRowsToShow, type SetEntry } from "@/lib/scoreEntry";
import { QUICK_MAX_SETS } from "@/lib/tennisScore";
import { updateQueued, useQueuedRecording } from "@/lib/recording/queue";
import { STOP_MESSAGES, type StopReason } from "@/lib/recording/safety";

/** Best of three: the third set's boxes go away unless the first two are split. */
const keepShownSets = (sets: SetEntry[]) => (setRowsToShow(sets) === 3 ? sets : sets.map((s, i) => (i === 2 ? emptySet() : s)));

export default function ScorePromptScreen() {
  const c = useColors();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    matchId: string;
    opponent?: string;
    league?: string;
    rec?: string;
    stopped?: string;
    /** Opened from Enter score on a recording card (D6): just the score, no recording section. */
    fromCard?: string;
  }>();
  const matchId = Number(params.matchId);
  const leagueId = params.league ? Number(params.league) : null;
  const opponent = params.opponent ?? "Opponent";
  const rec = useQueuedRecording(params.rec ?? null);
  const stopped = params.stopped as Exclude<StopReason, "user"> | undefined;
  const fromCard = params.fromCard === "1";

  // A Quick match is however many sets were played: two rows, and Add another set.
  const quick = leagueId == null;
  const [sets, setSets] = useState<SetEntry[]>(() => (quick ? [emptySet(), emptySet()] : [emptySet(), emptySet(), emptySet()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"saved" | "already" | null>(null);
  /** "recording": only the recording went. "match": a placeholder Quick match went with it. */
  const [discarded, setDiscarded] = useState<"recording" | "match" | null>(null);
  // A discarded placeholder Quick match no longer exists, so there is no score to enter.
  const matchGone = discarded === "match";

  const [touched, setTouched] = useState(false);
  const draft = readScore(sets, { quick });
  const score = draft.ok ? draft.score : "";
  const rows = quick ? sets.length : setRowsToShow(sets);
  // Typed scores not saved yet: closing asks first.
  const sheet = useSheetClose(touched && !done && !saving);
  // A league match can be edited for 24 hours from Match detail; a Quick match can't.
  const scheduleQ = useGetLeagueSchedule(leagueId ?? 0, {
    query: { enabled: leagueId != null, queryKey: getGetLeagueScheduleQueryKey(leagueId ?? 0) },
  });
  const weeklyLeagueMatch = !!scheduleQ.data?.rounds.some((r) => r.matches.some((m) => m.matchId === matchId));

  function update(i: number, patch: Partial<SetEntry>) {
    setError(null);
    setTouched(true);
    setSets((prev) => {
      const next = prev.map((s, j) => (j === i ? { ...s, ...patch } : s));
      return quick ? next : keepShownSets(next);
    });
  }

  async function save() {
    if (!score) return;
    setSaving(true);
    setError(null);
    const result = await submitScore({ matchId, leagueId }, score, getToken).catch(() => ({
      ok: false as const,
      alreadyEntered: false,
      error: "Couldn't save the score. Check your connection and try again.",
    }));
    setSaving(false);
    if (result.ok || result.alreadyEntered) {
      setDone(result.ok ? "saved" : "already");
      // The recording's card stops offering Enter score (D6).
      if (params.rec) updateQueued(params.rec, { scoreEntered: true }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: todaysMatchesKey });
      queryClient.invalidateQueries({ queryKey: recordingsKey });
      // The league shows the result, and Home drops Record for this match.
      queryClient.invalidateQueries({ queryKey: getGetMyLeagueWeekQueryKey() });
      if (leagueId != null) void refreshLeague(queryClient, leagueId);
      AccessibilityInfo.announceForAccessibility(result.ok ? `Score saved, ${score}` : "A score is already in for this match");
    } else {
      setError(result.error);
    }
  }

  return (
    <SheetBody title="Enter score" close={sheet.close}>
      {stopped && STOP_MESSAGES[stopped] ? (
        <Card accessible style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-start" }}>
          <SymbolView name="exclamationmark.triangle" size={18} tintColor={c.ink} style={{ marginTop: 2 }} />
          <Text style={{ flex: 1 }}>{STOP_MESSAGES[stopped]}</Text>
        </Card>
      ) : null}

      {matchGone ? null : done ? (
        <View style={{ gap: spacing.space2 }} accessible>
          <Text variant="title" accessibilityRole="header">
            {done === "saved" ? "Score saved" : "Score already in"}
          </Text>
          <Text tone="inkMuted">
            {done === "saved" ? `${displayScore(score)} vs ${opponent}.` : "Your opponent entered it first. Either of you can edit it from the match for 24 hours."}
          </Text>
        </View>
      ) : (
        <View style={{ gap: spacing.space4 }}>
          <View style={{ gap: spacing.space1 }}>
            <Text variant="title">{`You vs. ${opponent}`}</Text>
            <Text variant="small" tone="inkMuted">
              {`Your games on top.${weeklyLeagueMatch ? " Either player can edit it for 24 hours after you save." : ""}`}
            </Text>
          </View>

          <ScoreGrid
            sets={sets}
            onChange={update}
            firstName="You"
            secondName={opponent.split(" ")[0]}
            activeSets={rows}
            firstPossessive="your"
            secondPossessive={`${opponent}'s`}
          />

          {quick && sets.length < QUICK_MAX_SETS ? (
            <Button
              variant="secondary"
              label="Add another set"
              onPress={() => {
                setSets((prev) => [...prev, emptySet()]);
                AccessibilityInfo.announceForAccessibility(`Set ${sets.length + 1} added`);
              }}
            />
          ) : null}

          <ScoreResult
            draft={draft}
            winner={draft.ok ? (draft.iWon ? "You win" : `${opponent.split(" ")[0]} wins`) : ""}
            prompt={
              quick
                ? "Enter the sets you played. The last can be a match tiebreak, like 10-7."
                : rows === 3
                  ? "Set 3 can be a match tiebreak, like 10-7."
                  : "The third set opens if you split the first two."
            }
            error={error}
          />
        </View>
      )}

      {fromCard ? null : rec ? (
        <View style={{ gap: spacing.space2 }}>
          <Text variant="section" tone="inkMuted" accessibilityRole="header">
            Your recording
          </Text>
          <LocalProcessingCard rec={rec} showEnterScore={false} onDiscarded={(r) => setDiscarded(r.matchRemoved ? "match" : "recording")} />
        </View>
      ) : (
        <Text tone="inkMuted" accessibilityLiveRegion="polite">
          {discarded === "match"
            ? "Recording and match discarded."
            : discarded === "recording"
              ? "Recording discarded."
              : "Your recording is uploaded. Ball Boi is analyzing it."}
        </Text>
      )}

      {done || matchGone ? (
        <Button label="Done" onPress={() => sheet.finish()} />
      ) : (
        <Button label="Save score" onPress={save} loading={saving} disabled={!score} />
      )}
    </SheetBody>
  );
}
