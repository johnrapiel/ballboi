import { useAuth, useUser } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetLeaguesQueryKey,
  getGetMyJoinRequestsQueryKey,
  getGetMyPlayersQueryKey,
  getInvite,
  joinLeagueViaInvite,
} from "@workspace/api-client-react";

import { Button, Card, Text } from "@/components/ui";
import { radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useGate } from "@/hooks/useGate";
import { cleanCode, savePendingJoinCode } from "@/lib/leagueInvite";
import { shortDate } from "@/lib/leagueSchedule";
import { playersLabel } from "@/lib/leagues";

// Join a league (decision C1, Oct 31 review). Opened by an invite link
// (https://ballboi.tennis/join/CODE or ballboi://join/CODE) and by a code
// typed on the Leagues tab. The code is filled in; there's one button. What
// it does depends on the league (decision 30):
// - Join league: before the season starts, the player is in.
// - Ask to join: a Private league that started or is full asks the organizer.
// - Join waitlist: an Open league that started or is full holds a spot for next season.

/** Centered at default sizes; scrolls at the largest text sizes. */
function Page({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: spacing.space6,
        paddingTop: insets.top + spacing.space6,
        paddingBottom: insets.bottom + spacing.space6,
        gap: spacing.space6,
      }}
    >
      {children}
    </ScrollView>
  );
}

function errorText(e: unknown, fallback: string): string {
  return (e as { data?: { error?: string } | null }).data?.error ?? fallback;
}

type Done = { kind: "joined" | "requested" | "waitlisted"; leagueId: number | null; message: string };

const ACTION_LABEL = { join: "Join league", request: "Ask to join", waitlist: "Join waitlist" } as const;

export default function JoinLeagueScreen() {
  const c = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const params = useLocalSearchParams<{ code: string }>();
  const code = cleanCode(String(params.code ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // Signed in but not past the age check or onboarding (or blocked): the root
  // gate moves them on and keeps this link for later, so show nothing here (A3).
  const gate = useGate();
  const held = !!isSignedIn && gate !== "app";

  // Signed out: remember the link so it opens again after sign-in.
  useEffect(() => {
    if (isLoaded && !isSignedIn && code) void savePendingJoinCode(code);
  }, [isLoaded, isSignedIn, code]);

  const inviteQ = useQuery({
    queryKey: ["invite", code],
    queryFn: () => getInvite(code),
    enabled: !!code && !!isSignedIn && !held,
    retry: false,
  });
  const invite = inviteQ.data;
  const status = (inviteQ.error as { status?: number } | null)?.status;

  const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/leagues"));
  const openLeague = (leagueId: number) => router.replace({ pathname: "/league/[leagueId]", params: { leagueId: String(leagueId) } });

  const playerName =
    user?.fullName?.trim() || user?.firstName?.trim() || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "Player";

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await joinLeagueViaInvite(code, { playerName });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetLeaguesQueryKey().slice(0, 1) }),
        queryClient.invalidateQueries({ queryKey: getGetMyPlayersQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetMyJoinRequestsQueryKey() }),
      ]);
      const next: Done = result.requested
        ? { kind: "requested", leagueId: result.league.id ?? null, message: result.message }
        : result.waitlisted
          ? { kind: "waitlisted", leagueId: result.league.id ?? null, message: result.message }
          : { kind: "joined", leagueId: result.league.id ?? null, message: `You joined ${result.league.name ?? "the league"}.` };
      setDone(next);
      AccessibilityInfo.announceForAccessibility(next.message);
    } catch (e) {
      const s = (e as { status?: number }).status;
      setError(
        s === 410
          ? "This invite has ended. Ask the organizer for a new one."
          : s
            ? errorText(e, "Couldn't join. Try again in a moment.")
            : "Couldn't join. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!isLoaded) return <Page>{null}</Page>;
  if (held) {
    return (
      <Page>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
      </Page>
    );
  }

  // ── Signed out ────────────────────────────────────────────────────────────
  if (!isSignedIn) {
    return (
      <Page>
        <View style={{ gap: spacing.space2 }}>
          <Text variant="title" accessibilityRole="header">
            You're invited to a league
          </Text>
          <Text tone="inkMuted">Sign in to Ball Boi to join. This invite opens again once you're in.</Text>
        </View>
        <Button label="Sign in" onPress={() => router.replace("/(auth)/welcome")} />
      </Page>
    );
  }

  // ── Loading and problems ──────────────────────────────────────────────────
  if (code && inviteQ.isLoading) {
    return (
      <Page>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading invite" />
      </Page>
    );
  }
  if (!invite) {
    const ended = status === 410;
    const missing = status === 404 || !code;
    return (
      <Page>
        <View style={{ gap: spacing.space2 }}>
          <Text variant="title" accessibilityRole="header">
            {ended ? "This invite has ended" : missing ? "That code didn't work" : "Couldn't load this invite"}
          </Text>
          <Text tone="inkMuted">
            {ended
              ? "Ask the organizer for a new invite."
              : missing
                ? code
                  ? `There's no league with the code ${code}. Check it with the organizer.`
                  : "This link is missing its code. Ask the organizer to send it again."
                : "Check your connection and try again."}
          </Text>
        </View>
        <View style={{ gap: spacing.space3 }}>
          {!ended && !missing ? <Button label="Try again" onPress={() => void inviteQ.refetch()} /> : null}
          <Button label="Close" variant={!ended && !missing ? "secondary" : "primary"} onPress={close} />
        </View>
      </Page>
    );
  }

  const leagueName = invite.leagueName ?? "this league";
  const details = [
    invite.playerCount != null ? playersLabel(invite.playerCount) : null,
    invite.startDate ? `${invite.joinAction === "join" ? "Starts" : "Started"} ${shortDate(invite.startDate)}` : null,
    invite.location,
  ]
    .filter(Boolean)
    .join(" · ");

  // ── After joining ─────────────────────────────────────────────────────────
  if (done || invite.alreadyMember || invite.pendingRequest) {
    const state: Done = done ?? {
      kind: invite.alreadyMember ? "joined" : invite.pendingRequest === "waitlist" ? "waitlisted" : "requested",
      leagueId: invite.leagueId,
      message: invite.alreadyMember
        ? `You're already in ${leagueName}.`
        : invite.pendingRequest === "waitlist"
          ? "You're on the waitlist for next season."
          : "You've asked to join. The organizer will decide, and you'll hear back here.",
    };
    const title = state.kind === "joined" ? "You're in" : state.kind === "requested" ? "Request sent" : "You're on the waitlist";
    return (
      <Page>
        <View accessible style={{ gap: spacing.space2 }}>
          <Text variant="label" tone="inkMuted">
            {leagueName}
          </Text>
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
          <Text tone="inkMuted">{state.message}</Text>
        </View>
        {state.kind === "joined" && state.leagueId ? (
          <Button label="Open league" onPress={() => openLeague(state.leagueId!)} />
        ) : (
          <Button label="Done" onPress={() => router.replace("/(tabs)/leagues")} />
        )}
      </Page>
    );
  }

  // ── The invite ────────────────────────────────────────────────────────────
  const action = invite.joinAction ?? "join";
  const note =
    action === "request"
      ? /full/.test(invite.joinNote ?? "")
        ? "This league is full. You can ask the organizer to make room."
        : "This season's already started. You can ask the organizer to let you in."
      : action === "waitlist"
        ? "This league isn't taking players this season. Join the waitlist to get a spot when next season opens."
        : null;
  return (
    <Page>
      <View style={{ gap: spacing.space2 }}>
        <Text variant="label" tone="inkMuted">
          League invite
        </Text>
        <Text variant="displayL" accessibilityRole="header">
          {leagueName}
        </Text>
        {details ? <Text tone="inkMuted">{details}</Text> : null}
      </View>

      {/* The code, filled in from the link, in the same ticket style as the code sheet. */}
      <View
        accessible
        accessibilityLabel={`Invite code ${code.split("").join(" ")}`}
        style={{
          minHeight: 64,
          justifyContent: "center",
          paddingHorizontal: spacing.space4,
          backgroundColor: c.sand,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: c.hairlineStrong,
          borderRadius: radius.radiusMd,
          gap: spacing.space1,
        }}
      >
        <Text variant="label" tone="inkMuted">
          Invite code
        </Text>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.5}
          style={[type.bodyStrong, { fontSize: 22, lineHeight: 28, letterSpacing: 5, fontVariant: ["lining-nums", "tabular-nums"] }]}
        >
          {code}
        </Text>
      </View>

      {note ? (
        <Card>
          <Text>{note}</Text>
        </Card>
      ) : null}

      <View style={{ gap: spacing.space3 }}>
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button
          label={ACTION_LABEL[action]}
          onPress={() => void join()}
          loading={busy}
          accessibilityHint={
            action === "request" ? "Sends the organizer a request" : action === "waitlist" ? "Holds a spot for next season" : `Joins ${leagueName}`
          }
        />
        <Button label="Not now" variant="secondary" onPress={close} />
      </View>
    </Page>
  );
}
