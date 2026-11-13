// Edit score for a Discover or Quick match (decision 151, John, Nov 8),
// opened from the pencil next to the score on Match detail. The same 24-hour
// edit as a league score (decision 100): the boxes start with the score as it
// stands, from your side, the latest edit stands and the other player sees
// "Score edited by {name}". These matches have no league, so saving never
// touches standings. As many sets as were played, like the Quick match score
// prompt. A bottom sheet: Close (X) or drag down to close (asks first if you changed it).
// League matches keep the league's Enter score with ?edit=1.

import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator } from "react-native";

import {
  getGetMyCareerQueryKey,
  getGetMyLeagueWeekQueryKey,
  getGetMyMatchQueryKey,
  getGetMyNewMilestonesQueryKey,
  useEditMyMatchScore,
  useGetMyMatch,
} from "@workspace/api-client-react";

import { ScoreGrid, ScoreResult } from "@/components/league/ScoreGrid";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { CASUAL_LOCKED } from "@/lib/myMatches";
import { emptySet, hasScoreChange, NO_CHANGES, readScore, setsFromScore, type SetEntry } from "@/lib/scoreEntry";
import { QUICK_MAX_SETS } from "@/lib/tennisScore";

export default function EditMatchScoreScreen() {
  const c = useColors();
  const queryClient = useQueryClient();
  const { matchId: raw } = useLocalSearchParams<{ matchId: string }>();
  const matchId = Number(raw);
  const q = useGetMyMatch(matchId);
  const d = q.data;
  const change = useEditMyMatchScore();

  const [sets, setSets] = useState<SetEntry[]>([emptySet(), emptySet()]);
  const [prefilled, setPrefilled] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheet = useSheetClose(touched && !change.isPending);
  const draft = readScore(sets, { quick: true });
  // Save edit stays off until the score differs from the saved one (finding 14).
  const changed = hasScoreChange(draft, d?.score);
  const unchanged = draft.ok && !changed;

  // Start from the score as it stands, from your side.
  useEffect(() => {
    if (!prefilled && d?.score) {
      const count = Math.max(2, d.score.split(",").length);
      setSets(setsFromScore(d.score, count));
      setPrefilled(true);
    }
  }, [prefilled, d?.score]);

  const them = d ? d.opponents.players.map((p) => p.name).join(" & ") || "your opponent" : "your opponent";
  const themShort = them.split(" ")[0];

  function update(i: number, patch: Partial<SetEntry>) {
    setError(null);
    setTouched(true);
    setSets((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  async function save() {
    if (!draft.ok || !changed || change.isPending) return;
    try {
      await change.mutateAsync({ matchId, data: { score: draft.score } });
      void queryClient.invalidateQueries({ queryKey: getGetMyMatchQueryKey(matchId) });
      void queryClient.invalidateQueries({ queryKey: getGetMyLeagueWeekQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetMyCareerQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetMyNewMilestonesQueryKey() });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Score edited");
      sheet.finish();
    } catch (e) {
      const data = (e as { data?: { error?: string } | null }).data;
      setError(data?.error ?? "Couldn't save the score. Check your connection and try again.");
      void q.refetch();
    }
  }

  if (!d) {
    return (
      <SheetBody title="Edit score" close={sheet.close}>
        {q.isLoading ? (
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading match" />
        ) : (
          <Card style={{ gap: spacing.space3 }}>
            <Text variant="bodyStrong">Couldn't load this match</Text>
            <Text variant="small" tone="inkMuted">
              Check your connection and try again.
            </Text>
            <Button label="Try again" variant="secondary" loading={q.isRefetching} onPress={() => void q.refetch()} />
          </Card>
        )}
      </SheetBody>
    );
  }

  const locked = !d.editUntil;

  return (
    <SheetBody title="Edit score" close={sheet.close}>
      <Text variant="title">{`You vs. ${them}`}</Text>
      <Text variant="small" tone="inkMuted">
        {[d.context, d.score ? `Now: ${d.score}. The latest edit stands, and ${themShort} sees that you edited it.` : null].filter(Boolean).join(" · ")}
      </Text>

      {locked ? (
        <Card>
          <Text variant="bodyStrong">{CASUAL_LOCKED}</Text>
        </Card>
      ) : (
        <>
          <ScoreGrid
            sets={sets}
            onChange={update}
            firstName="You"
            secondName={themShort}
            activeSets={sets.length}
            firstPossessive="your"
            secondPossessive={`${them}'s`}
          />
          {sets.length < QUICK_MAX_SETS ? (
            <Button
              variant="secondary"
              label="Add another set"
              onPress={() => {
                setTouched(true);
                setSets((prev) => [...prev, emptySet()]);
                AccessibilityInfo.announceForAccessibility(`Set ${sets.length + 1} added`);
              }}
            />
          ) : null}
          <ScoreResult
            draft={draft}
            winner={draft.ok ? (draft.iWon ? "You win" : `${themShort} wins`) : ""}
            prompt="Your games on top. Enter the sets you played. The last can be a match tiebreak, like 10-7."
            error={error}
          />
        </>
      )}

      <Button
        label="Save edit"
        onPress={() => void save()}
        disabled={locked || !changed}
        loading={change.isPending}
        accessibilityLabel={!locked && unchanged ? `Save edit. ${NO_CHANGES}` : undefined}
        accessibilityHint={!locked && unchanged ? undefined : `Saves the new score. ${themShort} sees that you edited it.`}
      />
    </SheetBody>
  );
}
