// Delete account, opened from Profile and from the account blocked screen.
// Spec: Navigation (Profile holds account deletion) and App Store implications,
// "Account deletion" (guideline 5.1.1(v)). Deletes data, never just deactivates.
// Standard iOS pattern: an explanation screen, a red button, then a native
// confirmation alert. Destructive actions are red and confirmed (CLAUDE.md).
//
// Leagues you run alone (Wave 1 review S4, John's call): before the
// confirmation, pick who takes over each one, or Skip and the longest-standing
// member does. This never blocks deletion: if the list can't load, the
// server still hands each league to its longest-standing member.
//
// After deleting, recordings still waiting to upload are removed from the
// phone along with the rest of the account (A10).

import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Alert, ScrollView, View } from "react-native";

import { RadioCard } from "@/components/RadioCard";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { apiErrorMessage } from "@/lib/api";
import {
  deleteMyAccount,
  fetchLeagueHandoff,
  skipSuccessor,
  type HandoffLeague,
  type HandoffPicks,
} from "@/lib/accountDeletion";
import { clearUploadQueue } from "@/lib/recording/uploader";

const DELETED = [
  "Your sign-in, so you can't sign back in to this account",
  "Your profile, photo, level, and contact details",
  "Your messages and conversations",
  "The video of every match you recorded with Ball Boi, including any still on this phone",
  "Your requests to join leagues and your waitlist spots",
  "Your availability, location, and notification settings",
];

const KEPT = [
  "Scores from league matches you played stay in your opponents' history, listed as \"Deleted player.\"",
  "Opponents keep their replay and stats from matches you recorded. Your video is still deleted.",
  "Leagues you run keep going. If you're a league's only admin, the member you choose takes over, or the longest-standing member if you skip.",
];

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <Card style={{ gap: spacing.space3 }}>
      <Text variant="label" accessibilityRole="header">
        {title}
      </Text>
      {items.map((item) => (
        <View key={item} style={{ flexDirection: "row", gap: spacing.space2 }} accessible accessibilityLabel={item}>
          <Text tone="inkMuted" importantForAccessibility="no">
            {"•"}
          </Text>
          <Text style={{ flex: 1 }}>{item}</Text>
        </View>
      ))}
    </Card>
  );
}

function joinedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "League member";
  return `Joined ${d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`;
}

/** "Who runs Tuesday Flex next?" with the league's members to pick from. */
function PickAdmin({
  league,
  position,
  total,
  picked,
  onPick,
  onContinue,
  onSkip,
}: {
  league: HandoffLeague;
  position: number;
  total: number;
  picked: number | null;
  onPick: (playerId: number) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const skipTo = skipSuccessor(league);
  return (
    <>
      <View style={{ gap: spacing.space2 }}>
        {total > 1 ? (
          <Text variant="label" tone="inkMuted">
            {`League ${position} of ${total}`}
          </Text>
        ) : null}
        <Text variant="title" accessibilityRole="header">
          {`Who runs ${league.name} next?`}
        </Text>
        <Text tone="inkMuted">You're this league's only admin. Choose a member to take over before you delete your account.</Text>
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel={`New admin for ${league.name}`} style={{ gap: spacing.space3 }}>
        {league.members.map((m) => (
          <RadioCard
            key={m.playerId}
            title={m.name}
            description={joinedLabel(m.joinedAt)}
            selected={picked === m.playerId}
            onPress={() => onPick(m.playerId)}
          />
        ))}
      </View>

      <View style={{ gap: spacing.space3 }}>
        <Button label="Continue" disabled={picked == null} onPress={onContinue} />
        <Button
          label="Skip"
          variant="secondary"
          onPress={onSkip}
          accessibilityHint={skipTo ? `${skipTo.name} takes over` : undefined}
        />
        {skipTo ? (
          <Text variant="small" tone="inkMuted">
            {`If you skip, ${skipTo.name} takes over. They've been in the league the longest.`}
          </Text>
        ) : null}
      </View>
    </>
  );
}

export default function DeleteAccountScreen() {
  const c = useColors();
  const bottom = useScreenBottomInset();
  const { getToken, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which league's new admin is being picked, or null on the explanation. */
  const [picking, setPicking] = useState<number | null>(null);
  const [picks, setPicks] = useState<HandoffPicks>({});

  const handoff = useQuery({
    queryKey: ["account", "leagueHandoff"],
    queryFn: () => fetchLeagueHandoff(getToken),
    // If it can't load, deletion goes ahead and the server picks.
    retry: false,
  });
  const leagues = handoff.data ?? [];

  async function deleteAccount(chosen: HandoffPicks) {
    setError(null);
    setPicking(null);
    setBusy(true);
    try {
      const res = await deleteMyAccount(getToken, chosen);
      if (!res.ok) {
        setError(await apiErrorMessage(res, "We couldn't delete your account. Try again."));
        return;
      }
      // Nothing from this account stays on the phone or uploads later.
      await clearUploadQueue().catch(() => undefined);
      // The server already deleted the sign-in; clear the local session too
      // (tried twice: a dropped connection mustn't leave it signed in). The
      // root gate then clears every screen and opens Welcome, with nothing to
      // go back to, and clears the cached data (finding 59).
      await signOut().catch(() => signOut().catch(() => undefined));
    } catch {
      setError("We couldn't reach Ball Boi. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  /** The picks are passed along, not read from state, so a last-moment Skip counts. */
  function confirm(chosen: HandoffPicks) {
    Alert.alert("Delete your account?", "This can't be undone.", [
      { text: "Cancel", style: "cancel", onPress: () => setPicking(null) },
      { text: "Delete", style: "destructive", onPress: () => void deleteAccount(chosen) },
    ]);
  }

  /** Delete account: first the leagues to hand over, then the confirmation. */
  function start() {
    if (leagues.length) setPicking(0);
    else confirm(picks);
  }

  function next(chosen: HandoffPicks) {
    setPicks(chosen);
    if (picking == null) return;
    if (picking + 1 < leagues.length) setPicking(picking + 1);
    else confirm(chosen);
  }

  const league = picking != null ? leagues[picking] : undefined;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{
        padding: spacing.space4,
        paddingBottom: bottom.paddingBottom,
        gap: spacing.space6,
      }}
      scrollIndicatorInsets={bottom.scrollIndicatorInsets}
    >
      {league ? (
        <PickAdmin
          key={league.leagueId}
          league={league}
          position={picking! + 1}
          total={leagues.length}
          picked={picks[league.leagueId] ?? null}
          onPick={(playerId) => setPicks((p) => ({ ...p, [league.leagueId]: playerId }))}
          onContinue={() => next(picks)}
          onSkip={() => next({ ...picks, [league.leagueId]: null })}
        />
      ) : (
        <>
          <Text>This permanently deletes your Ball Boi account. You can't undo it.</Text>

          <List title="What's deleted" items={DELETED} />
          <List title="What stays" items={KEPT} />

          {error ? (
            <Text tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <Button
            label="Delete account"
            variant="destructive"
            // Waits a moment for the leagues you run, so you can pick who takes over.
            loading={busy || handoff.isPending}
            onPress={start}
          />
        </>
      )}
    </ScrollView>
  );
}
