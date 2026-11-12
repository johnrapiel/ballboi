import { useAuth, useUser } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PartnerCard } from "@/components/league/PartnerCard";
import { useGetMyPartner } from "@workspace/api-client-react";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetMyJoinRequestsQueryKey,
  getInvite,
  joinLeagueViaInvite,
} from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { RatingBadge } from "@/components/RatingBadge";
import { Button, Card, Text, TextButton } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useGate } from "@/hooks/useGate";
import { useProfile } from "@/hooks/useProfile";
import { cleanCode, savePendingJoinCode } from "@/lib/leagueInvite";
import { askForNotifications } from "@/lib/notifications";
import { refreshLeague } from "@/lib/leagueRefresh";
import { shortDate } from "@/lib/leagueSchedule";
import { photoUrl } from "@/lib/photos";

// Join a league (decision C1, Oct 31 review). Opened by an invite link
// (https://ballboi.tennis/join/CODE or ballboi://join/CODE) and by a code
// typed on the Leagues tab. The code is filled in; there's one button. What
// it does depends on the league (decision 30):
// - Join league: before the season starts, the player is in.
// - Ask to join: a Private league that started or is full asks the organizer.
// - Join waitlist: an Open league that started or is full holds a spot for next season.
// Approved canvas: Join league invite. The invite as a card with a brush
// title, Where, Players and Starts as a list, "You'll join as" from your
// profile, and the one button pinned at the bottom. Cancel at the top left,
// like any iOS modal.

/** A label and value row in the invite's list. */
function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${value}`}
      style={{
        minHeight: 52,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
      }}
    >
      <Text>{label}</Text>
      <Text tone="inkMuted">{value}</Text>
    </View>
  );
}

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

const ACTION_LABEL = { join: "Join the league", request: "Ask to join", waitlist: "Join waitlist" } as const;

/**
 * D9: in a fixed-partner doubles league, the team-up step comes right after
 * joining, and Open league steps back to secondary under it. Otherwise Open
 * league is the one primary action.
 */
function JoinedActions({ leagueId, onOpen }: { leagueId: number; onOpen: () => void }) {
  const q = useGetMyPartner(leagueId);
  const step = !!q.data?.fixedPartners && q.data.member && !q.data.partner && q.data.teamingOpen;
  return (
    <>
      {step ? <PartnerCard leagueId={leagueId} /> : null}
      <Button label="Open league" variant={step ? "secondary" : "primary"} onPress={onOpen} />
    </>
  );
}

export default function JoinLeagueScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
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
  // The league itself has ended, not just this invite. Nothing is sent to the admin.
  const leagueEnded = (inviteQ.error as { data?: { code?: string } | null } | null)?.data?.code === "league_ended";

  const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/leagues"));
  const openLeague = (leagueId: number) => router.replace({ pathname: "/league/[leagueId]", params: { leagueId: String(leagueId) } });

  // A1: the league shows the profile name, never any part of the email. The
  // API uses the saved profile too; this is only its fallback.
  const { profile } = useProfile();
  const playerName = profile?.displayName?.trim() || user?.fullName?.trim() || "Player";

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await joinLeagueViaInvite(code, { playerName });
      await Promise.all([
        refreshLeague(queryClient, result.league.id ?? null),
        queryClient.invalidateQueries({ queryKey: getGetMyJoinRequestsQueryKey() }),
      ]);
      const next: Done = result.requested
        ? { kind: "requested", leagueId: result.league.id ?? null, message: result.message }
        : result.waitlisted
          ? { kind: "waitlisted", leagueId: result.league.id ?? null, message: result.message }
          : { kind: "joined", leagueId: result.league.id ?? null, message: `You joined ${result.league.name ?? "the league"}.` };
      setDone(next);
      AccessibilityInfo.announceForAccessibility(next.message);
      // Joining a league: the notifications prompt, the first time (decision 125).
      void askForNotifications("joinedLeague");
    } catch (e) {
      const s = (e as { status?: number }).status;
      const code = (e as { data?: { code?: string } | null }).data?.code;
      setError(
        s === 410 && code === "league_ended"
          ? "This league has ended"
          : s === 410
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
            {leagueEnded ? "This league has ended" : ended ? "This invite has ended" : missing ? "That code didn't work" : "Couldn't load this invite"}
          </Text>
          <Text tone="inkMuted">
            {leagueEnded
              ? "Its season is over, so it isn't taking new players."
              : ended
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
  const rows = [
    invite.location ? { label: "Where", value: invite.location } : null,
    invite.playerCount != null ? { label: "Players", value: `${invite.playerCount} joined` } : null,
    invite.startDate ? { label: invite.joinAction === "join" ? "Starts" : "Started", value: shortDate(invite.startDate) } : null,
  ].filter((r): r is { label: string; value: string } => !!r);

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
          <JoinedActions leagueId={state.leagueId} onOpen={() => openLeague(state.leagueId!)} />
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
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space3, paddingBottom: spacing.space6, gap: spacing.space4 }}
      >
        <TextButton label="Cancel" onPress={close} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />

        <Card style={{ alignItems: "center", gap: spacing.space2, paddingVertical: spacing.space6 }}>
          <Text variant="small" tone="inkMuted">
            You're invited to
          </Text>
          <Text variant="headingM" accessibilityRole="header" style={{ textAlign: "center" }}>
            {leagueName}
          </Text>
          <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }} accessibilityLabel={`Invite code ${code.split("").join(" ")}`}>
            {`Invite code ${code}`}
          </Text>
        </Card>

        {rows.length ? (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {rows.map((r, i) => (
              <DetailRow key={r.label} label={r.label} value={r.value} last={i === rows.length - 1} />
            ))}
          </Card>
        ) : null}

        {note ? (
          <Card>
            <Text>{note}</Text>
          </Card>
        ) : null}

        <View style={{ gap: spacing.space2 }}>
          <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
            You'll join as
          </Text>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
            <Avatar name={playerName} uri={photoUrl(profile?.avatarUrl)} size={44} />
            <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
              <Text variant="bodyStrong">{playerName}</Text>
              {profile?.rating != null ? <RatingBadge rating={profile.rating} source={profile.ratingSource ?? "self"} /> : null}
            </View>
          </Card>
          <Text variant="small" tone="inkMuted" style={{ paddingHorizontal: spacing.space1 }}>
            From your profile. Change it anytime in Profile.
          </Text>
        </View>
      </ScrollView>

      {/* The one button, pinned at the bottom (approved canvas). */}
      <View
        style={{
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space3,
          paddingBottom: insets.bottom + spacing.space3,
          gap: spacing.space2,
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          backgroundColor: c.paper,
        }}
      >
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
            action === "request" ? "Sends the league admin a request" : action === "waitlist" ? "Holds a spot for next season" : `Joins ${leagueName}`
          }
        />
      </View>
    </View>
  );
}
