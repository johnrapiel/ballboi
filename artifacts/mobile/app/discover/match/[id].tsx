// One open match (canvas W2_OpenMatchDetail, W2_OpenMatchJoined,
// W2_OpenMatchMine, W2_OpenMatchTaken, W2_CancelPost; brief items 40 to 44).
// When and what, the level range (a guide), court, note, and who's in with
// the open spots. One pinned action at the bottom: I'm in, or Open group
// chat once it's full. Cancel match (your post) and Drop out (you're in) are
// quiet red text at the end of the content instead (decision 184).

import { Icon, type IconName } from "@/components/Icon";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { AccessibilityInfo, Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { DangerLink } from "@/components/DangerLink";
import { DetailRow } from "@/components/discover/DetailRow";
import { ProblemCard } from "@/components/discover/States";
import { RatingBadge } from "@/components/RatingBadge";
import { Button, Card, Pill, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { OpenMatchError, useOpenMatch, useOpenMatchAction } from "@/hooks/useDiscoverOpenMatches";
import { usePinnedBarHeight, useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { firstName, needLabel, waitingLine, whosInLine } from "@/lib/discover";

export default function OpenMatchScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The last content sits a full gap above the pinned button (decision 194).
  const pinned = usePinnedBarHeight();
  const bottom = useScreenBottomInset({ pinnedHeight: pinned.height });
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const q = useOpenMatch(id);
  const act = useOpenMatchAction(id);
  const [filled, setFilled] = useState(false);
  const m = q.data;

  const fail = (e: unknown) =>
    Alert.alert("Couldn't do that", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.");
  const openChat = () => router.push({ pathname: "/discover/match/chat/[id]", params: { id: String(id) } });

  async function join() {
    try {
      const after = await act.mutateAsync({ action: "join" });
      if ("status" in after && after.status === "full") {
        AccessibilityInfo.announceForAccessibility("You're in. Every spot is filled. Opening the group chat.");
        router.replace({ pathname: "/discover/match/chat/[id]", params: { id: String(id) } });
      } else AccessibilityInfo.announceForAccessibility("You're in, waiting to fill");
    } catch (e) {
      if (e instanceof OpenMatchError && e.code === "filled") {
        setFilled(true);
        AccessibilityInfo.announceForAccessibility("This spot just filled");
      } else fail(e);
    }
  }

  function dropOut() {
    if (!m) return;
    const day = new Date(m.startsAt).toLocaleDateString("en-US", { weekday: "long" });
    const poster = firstName(m.players.find((p) => p.poster)?.name ?? "The poster");
    Alert.alert(
      `Drop out of ${day}'s match?`,
      `Your spot opens back up in Discover and ${poster} gets a notification. Dropping out before the match never counts as a no-show.`,
      [
        { text: "Stay in", style: "cancel" },
        {
          text: "Drop out",
          style: "destructive",
          onPress: () =>
            act
              .mutateAsync({ action: "drop" })
              .then(() => AccessibilityInfo.announceForAccessibility("You dropped out"))
              .catch(fail),
        },
      ],
    );
  }

  function cancelPost() {
    Alert.alert(
      "Cancel this match?",
      "It leaves Discover, and everyone who joined gets a notification that it's off. Canceling before the match never counts as a no-show.",
      [
        { text: "Keep match", style: "cancel" },
        {
          text: "Cancel match",
          style: "destructive",
          onPress: () =>
            act
              .mutateAsync({ action: "cancel" })
              .then(() => {
                AccessibilityInfo.announceForAccessibility("Match canceled");
                router.back();
              })
              .catch(fail),
        },
      ],
    );
  }

  if (!m) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4 }}>
        <Stack.Screen options={{ title: "" }} />
        {q.isLoading ? (
          <Card style={{ height: 180, backgroundColor: c.sand, borderColor: c.sand }} accessible accessibilityLabel="Loading match" />
        ) : q.error && /isn't open/.test(q.error.message) ? (
          <Card style={{ gap: spacing.space2 }}>
            <Text variant="title">This match isn't open any more</Text>
            <Text tone="inkMuted">It was canceled or filled up. Here are other open matches near you.</Text>
            <Button label="See open matches" variant="secondary" onPress={() => router.back()} />
          </Card>
        ) : (
          <ProblemCard
            title="Can't load this match right now"
            body="Check your connection and try again."
            onRetry={() => void q.refetch()}
            retrying={q.isRefetching}
          />
        )}
      </View>
    );
  }

  const full = m.status === "full";
  const need = m.format === "doubles" && !full && m.spotsLeft > 0 ? m.spotsLeft : null;
  const [day, window] = m.when.split(" · ");

  // Decision 184: leaving or canceling is quiet red text at the end of the
  // content, not a pinned button. Still confirmed by the alert (decision 193).
  const quiet =
    filled || (full && m.role !== "none") ? null : m.role === "poster" ? (
      <DangerLink label="Cancel match" icon="xmark.circle" busy={act.isPending} onPress={cancelPost} />
    ) : m.role === "in" ? (
      <DangerLink label="Drop out" icon="door.leave" busy={act.isPending} disabled={m.started} onPress={dropOut} />
    ) : null;

  const footer = filled ? (
    <Button label="See open matches" variant="secondary" onPress={() => router.back()} />
  ) : full && m.role !== "none" ? (
    <Button label="Open group chat" onPress={openChat} />
  ) : m.role === "poster" || m.role === "in" ? null : full || m.started ? (
    <Button label="See open matches" variant="secondary" onPress={() => router.back()} />
  ) : (
    <Button label="I'm in" loading={act.isPending} onPress={() => void join()} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen options={{ title: "" }} />
      <ScrollView contentContainerStyle={{ padding: spacing.space4, paddingBottom: bottom.paddingBottom, gap: spacing.space4 }} scrollIndicatorInsets={bottom.scrollIndicatorInsets}>
        <View style={{ gap: spacing.space2 }}>
          <Text variant="headingL" accessibilityRole="header">
            {day}
          </Text>
          <Text variant="bodyStrong">{`${window} · ${m.format === "doubles" ? "Doubles" : "Singles"}`}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.space2 }}>
            {m.role === "poster" ? <Pill label="Your post" /> : null}
            {m.role === "in" ? <Pill label="You're in" /> : null}
            {need ? <Pill label={needLabel(need)} /> : null}
            {full ? <Pill label="Full" /> : null}
          </View>
        </View>

        {filled ? (
          <Note
            symbol="person.3.fill"
            title="This spot just filled"
            body="Someone got there first. Here are other open matches near you."
          />
        ) : m.role === "in" && !full ? (
          <Note symbol="checkmark.circle" title="You're in" body={waitingLine(m.spotsLeft)} />
        ) : m.role === "poster" && !full ? (
          <Note
            symbol="megaphone"
            title="Posted"
            body="Players near you who fit can see it. When the last spot fills, a group chat opens for everyone and the post leaves Discover."
          />
        ) : null}

        <Card style={{ padding: 0, overflow: "hidden" }}>
          <DetailRow label="Level" value={`${m.levelText.replace(/^Level /, "")}. A guide: anyone can join.`} />
          <DetailRow label="Court" value={[m.courtName ?? "Not set", m.distance].filter(Boolean).join(" · ")} last={!m.note} />
          {m.note ? <DetailRow label="Note" value={m.note} last /> : null}
        </Card>

        <View style={{ gap: spacing.space2 }}>
          <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
            {whosInLine(m)}
          </Text>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {m.players.map((p, i) => (
              <View
                key={`${p.userId}-${i}`}
                accessible
                accessibilityLabel={[p.name, p.poster ? "posted this" : null, p.rating != null ? `level ${p.rating.toFixed(1)}` : null]
                  .filter(Boolean)
                  .join(", ")}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.space3,
                  padding: spacing.space3,
                  minHeight: 56,
                  borderBottomWidth: 1,
                  borderBottomColor: c.hairline,
                }}
              >
                <Avatar name={p.name} uri={p.avatarUrl} size={36} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{p.name}</Text>
                  {p.poster ? (
                    <Text variant="small" tone="inkMuted">
                      Posted this
                    </Text>
                  ) : null}
                </View>
                {p.rating != null ? <RatingBadge rating={p.rating} source="self" /> : null}
              </View>
            ))}
            {Array.from({ length: m.spotsLeft }, (_, i) => (
              <View
                key={`open-${i}`}
                accessible
                accessibilityLabel="Open spot"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.space3,
                  padding: spacing.space3,
                  minHeight: 56,
                  borderBottomWidth: i === m.spotsLeft - 1 ? 0 : 1,
                  borderBottomColor: c.hairline,
                }}
              >
                <View
                  style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderStyle: "dashed", borderColor: c.hairlineStrong }}
                />
                <Text tone="inkMuted">Open spot</Text>
              </View>
            ))}
          </Card>
        </View>
        {quiet}
      </ScrollView>
      {footer ? (
        <View
          onLayout={pinned.onLayout}
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
          {m.role === "none" && !full && !filled ? (
            <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
              {`First come, first served. The last spot opens a group chat for all ${m.total}.`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Note({ symbol, title, body }: { symbol?: IconName; title: string; body: string }) {
  const c = useColors();
  return (
    <Card
      style={{ flexDirection: "row", gap: spacing.space3, alignItems: "flex-start" }}
      accessible
      accessibilityLabel={`${title}. ${body}`}
      accessibilityLiveRegion="polite"
    >
      {symbol ? <Icon name={symbol} size={20} tintColor={c.ink} /> : null}
      <View style={{ flex: 1, gap: spacing.space1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small" tone="inkMuted">
          {body}
        </Text>
      </View>
    </Card>
  );
}
