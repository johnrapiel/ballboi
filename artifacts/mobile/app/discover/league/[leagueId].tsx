// An Open league from Discover (canvas W2_LeagueOpen, W2_LeagueOutside,
// W2_LeagueLocked, W2_RequestSent, W2_LeagueWaitlisted; brief items 17 to
// 22). What it is, and where you stand with it, with one action pinned at
// the bottom:
// - taking requests: "Request a spot" (opens the Request sheet)
// - started or full: "Join the waitlist" (for next season)
// - requested: "Request sent" with Cancel request
// - waitlisted: "You're on the waitlist" with Leave the waitlist
// - declined: said plainly, with a way back to Discover
// - you're in: Open the league
// Outside your level is a note, never a stop: the organizer decides.

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon, type IconName } from "@/components/Icon";
import React from "react";
import { AccessibilityInfo, Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailRow } from "@/components/discover/DetailRow";
import { ProblemCard } from "@/components/discover/States";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useAskToJoin, useDiscoverLeague, useWithdraw } from "@/hooks/useDiscoverLeagues";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { firstName, leagueStanding, seasonLine, spotsLine, type DiscoverLeague } from "@/lib/discover";

export default function DiscoverLeagueScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(params.leagueId);
  const q = useDiscoverLeague(leagueId);
  const ask = useAskToJoin(leagueId);
  const withdraw = useWithdraw(leagueId);
  const l = q.data;

  const fail = (e: unknown) =>
    Alert.alert("Couldn't do that", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");

  async function joinWaitlist() {
    try {
      await ask.mutateAsync(null);
      AccessibilityInfo.announceForAccessibility("You're on the waitlist");
    } catch (e) {
      fail(e);
    }
  }

  function confirmWithdraw(kind: "request" | "waitlist") {
    if (!l) return;
    Alert.alert(
      kind === "waitlist" ? "Leave the waitlist?" : "Cancel your request?",
      kind === "waitlist"
        ? `${firstName(l.organizerName)} won't see you for next season.`
        : `${firstName(l.organizerName)} won't see it any more.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: kind === "waitlist" ? "Leave the waitlist" : "Cancel request",
          style: "destructive",
          onPress: () =>
            withdraw
              .mutateAsync()
              .then(() => AccessibilityInfo.announceForAccessibility(kind === "waitlist" ? "You left the waitlist" : "Request canceled"))
              .catch(fail),
        },
      ],
    );
  }

  if (!l) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4, gap: spacing.space3 }}>
        <Stack.Screen options={{ title: "" }} />
        {q.isLoading ? (
          <Card style={{ height: 180, backgroundColor: c.sand, borderColor: c.sand }} accessible accessibilityLabel="Loading league" />
        ) : q.error && /isn't open/.test(q.error.message) ? (
          <Card style={{ gap: spacing.space2 }}>
            <Text variant="title">This league isn't open to new players right now</Text>
            <Text tone="inkMuted">It may have ended or become invite-only. Find another one near you.</Text>
            <Button label="Back to Discover" variant="secondary" onPress={() => router.back()} />
          </Card>
        ) : (
          <ProblemCard
            title="Can't load this league right now"
            body={isOfflineError(q.error) ? "You're offline. Check your connection and try again." : "Check your connection and try again."}
            onRetry={() => void q.refetch()}
            retrying={q.isRefetching}
          />
        )}
      </View>
    );
  }

  const standing = leagueStanding(l);
  const organizer = firstName(l.organizerName);
  const busy = ask.isPending || withdraw.isPending;

  const footer =
    standing === "member" ? (
      <Button
        label="Open the league"
        onPress={() => router.replace({ pathname: "/league/[leagueId]", params: { leagueId: String(l.leagueId) } })}
      />
    ) : standing === "requested" ? (
      <Button label="Cancel request" variant="destructiveOutline" loading={busy} onPress={() => confirmWithdraw("request")} />
    ) : standing === "waitlisted" ? (
      <Button label="Leave the waitlist" variant="destructiveOutline" loading={busy} onPress={() => confirmWithdraw("waitlist")} />
    ) : standing === "declined" ? (
      <Button label="Back to Discover" variant="secondary" onPress={() => router.back()} />
    ) : standing === "waitlist" ? (
      <Button
        label="Join the waitlist"
        loading={busy}
        onPress={() => void joinWaitlist()}
        accessibilityHint={`${organizer} can add you when the next season opens`}
      />
    ) : (
      <Button
        label="Request a spot"
        onPress={() =>
          router.push({ pathname: "/discover/request/[leagueId]", params: { leagueId: String(l.leagueId), organizer: l.organizerName } })
        }
      />
    );

  const footnote =
    standing === "request"
      ? `${organizer} approves requests${l.startLabel ? ` until the season starts on ${l.startLabel.replace(/^\w+, /, "")}` : ""}.`
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen options={{ title: "" }} />
      <ScrollView contentContainerStyle={{ padding: spacing.space4, paddingBottom: 140 + insets.bottom, gap: spacing.space4 }}>
        <View style={{ gap: spacing.space1 }}>
          <Text variant="headingL" accessibilityRole="header">
            {l.name}
          </Text>
          <Text tone="inkMuted">{`Open league · run by ${l.organizerName}`}</Text>
        </View>

        <StandingNote l={l} standing={standing} organizer={organizer} />

        <Card style={{ padding: 0, overflow: "hidden" }}>
          {rows(l).map((r, i, all) => (
            <DetailRow key={r.label} label={r.label} value={r.value} last={i === all.length - 1} />
          ))}
        </Card>
      </ScrollView>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space3,
          paddingBottom: insets.bottom + spacing.space3,
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          backgroundColor: c.paper,
          gap: spacing.space2,
        }}
      >
        {footer}
        {footnote ? (
          <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
            {footnote}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function rows(l: DiscoverLeague): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const where = [l.location, l.distance].filter(Boolean).join(" · ");
  if (where) out.push({ label: "Where", value: where });
  out.push({ label: "Format", value: [l.format, l.type, l.partners].filter(Boolean).join(" · ") });
  out.push({
    label: "Level",
    value: l.myRating != null ? `${l.levelText.replace(/^Level /, "")} · You're ${l.myRating.toFixed(1)}` : l.levelText,
  });
  out.push({ label: "Season", value: seasonLine(l) });
  const spots = spotsLine(l);
  if (spots) out.push({ label: "Spots", value: spots });
  return out;
}

function Note({ symbol, title, body }: { symbol: IconName; title: string; body: string }) {
  const c = useColors();
  return (
    <Card
      style={{ flexDirection: "row", gap: spacing.space3, alignItems: "flex-start" }}
      accessible
      accessibilityLabel={`${title}. ${body}`}
    >
      <Icon name={symbol} size={20} tintColor={c.ink} />
      <View style={{ flex: 1, gap: spacing.space1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small" tone="inkMuted">
          {body}
        </Text>
      </View>
    </Card>
  );
}

function StandingNote({ l, standing, organizer }: { l: DiscoverLeague; standing: ReturnType<typeof leagueStanding>; organizer: string }) {
  const notes: React.ReactNode[] = [];
  if (standing === "member")
    notes.push(<Note key="m" symbol="checkmark.circle" title="You're in this league" body="Your matches and standings are on its page." />);
  if (standing === "requested")
    notes.push(
      <Note
        key="r"
        symbol="paperplane"
        title="Request sent"
        body={`${organizer} will approve or decline${l.startLabel ? ` before ${l.startLabel.replace(/^\w+, /, "")}` : ""}. We'll let you know either way.`}
      />,
    );
  if (standing === "waitlisted")
    notes.push(
      <Note
        key="w"
        symbol="list.bullet.clipboard"
        title="You're on the waitlist"
        body={`${organizer} sees your name and level. We'll let you know when the next season opens.`}
      />,
    );
  if (standing === "declined")
    notes.push(
      <Note
        key="d"
        symbol="xmark.circle"
        title={`${organizer} said no this time`}
        body="It may be full or set up for a different group. Find another Open league near you."
      />,
    );
  if ((standing === "request" || standing === "waitlist") && l.started)
    notes.push(
      <Note
        key="s"
        symbol="calendar.badge.clock"
        title={`Season started${l.startLabel ? ` ${l.startLabel.replace(/^\w+, /, "")}` : ""}`}
        body={`New players can't join mid-season. Join the waitlist and ${organizer} can add you when the next season opens.`}
      />,
    );
  else if ((standing === "request" || standing === "waitlist") && l.full)
    notes.push(
      <Note
        key="f"
        symbol="person.3.fill"
        title="This league is full"
        body={`Join the waitlist and ${organizer} can add you when the next season opens.`}
      />,
    );
  if (l.outsideLevel && standing !== "member")
    notes.push(
      <Note
        key="o"
        symbol="arrow.up.arrow.down"
        title="Outside your level"
        body={`This league is for ${l.levelText.replace(/^Level /, "")}.${l.myRating != null ? ` You're ${l.myRating.toFixed(1)}.` : ""} You can still ask, and ${organizer} decides.`}
      />,
    );
  return notes.length ? <View style={{ gap: spacing.space3 }}>{notes}</View> : null;
}
