// Live match: the second phone (Wave 2, Session G; acceptance 32, 34, 35).
//
// Opens from the Live Activity on either player's Lock Screen (its Start
// match and Stop links, or a tap on it). The mounted phone faces the fence, so
// this is where a player sees what's happening and reads the voice coach's
// captions (G11): the stage, the time, the court, the mounted phone's battery
// and the coach's latest line, all in words.
//
// Start match starts the mounted phone now (line 19, then recording). Stop
// asks "Stop recording?" here first, then the mounted phone stops and saves.
// Either player has full controls. There's no canvas screen for it: it uses
// the design system's tokens and John reviews it in the PR.
//
// States: loading, can't load (Try again), nothing recording (Back), live,
// stopped. Back is always at the top left, and swipe back works.

import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { apiErrorMessage, apiFetch, isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { liveAction, STOP_CONFIRM_BODY, STOP_CONFIRM_TITLE, type LiveCommand, type LiveProps } from "@/lib/liveActivity/props";
import { liveClock, liveClockSpoken } from "@/lib/liveActivity/clock";

interface LiveView {
  live: boolean;
  props: LiveProps | null;
  youRecord: boolean;
}

/** How often this screen checks the mounted phone. */
const REFRESH_MS = 2_000;

export default function LiveMatchScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const params = useLocalSearchParams<{ matchId: string; action?: string }>();
  const matchId = Number(params.matchId);
  const valid = Number.isInteger(matchId) && matchId > 0;
  const key = ["live", matchId] as const;

  const q = useQuery({
    queryKey: key,
    enabled: valid,
    queryFn: async (): Promise<LiveView> => {
      const res = await apiFetch(`/api/live/${matchId}`, getToken);
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't load the match."));
      return (await res.json()) as LiveView;
    },
    refetchInterval: (query) => (query.state.data?.live ? REFRESH_MS : 10_000),
  });

  const [sending, setSending] = useState<LiveCommand | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<LiveCommand | null>(null);
  // Live, or stopped in the last few minutes ("Recording stopped" with Done).
  const props = q.data?.props ?? null;
  /** The Live Activity's Start or Stop couldn't apply by the time the screen opened. */
  const [actionNote, setActionNote] = useState<string | null>(null);

  async function send(command: LiveCommand) {
    if (sending) return;
    setSendError(null);
    setSending(command);
    try {
      const res = await apiFetch(`/api/live/${matchId}/command`, getToken, { method: "POST", body: JSON.stringify({ command }) });
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't reach the mounted phone. Try again."));
      setSent(command);
      AccessibilityInfo.announceForAccessibility(command === "start" ? "Starting on the mounted phone" : "Stopping on the mounted phone");
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setSendError(isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Couldn't reach the mounted phone. Try again.");
    } finally {
      setSending(null);
    }
  }

  function confirmStop() {
    Alert.alert(STOP_CONFIRM_TITLE, STOP_CONFIRM_BODY, [
      { text: "Keep recording", style: "cancel" },
      { text: "Stop", style: "destructive", onPress: () => void send("stop") },
    ]);
  }

  // The Live Activity's Start match and Stop links, once the match has loaded.
  const handledAction = useRef(false);
  useEffect(() => {
    if (handledAction.current || !q.data) return;
    handledAction.current = true;
    const action = liveAction(params.action);
    if (!action || !props) return;
    if (action === "start") {
      if (props.canStart) void send("start");
      else setActionNote(props.stage === "recording" ? "The match is already recording." : "The match can't start from here right now.");
    }
    if (action === "stop") {
      if (props.canStop) confirmStop();
      else setActionNote(props.stage === "stopped" ? "The recording has already stopped." : "There's no recording to stop yet.");
    }
    // Once, when the first answer arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  // A new coach line is read once by VoiceOver here; it plays out loud only from the mounted phone.
  const lastCaption = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const caption = props?.caption ?? null;
    if (lastCaption.current !== undefined && caption && caption !== lastCaption.current) {
      AccessibilityInfo.announceForAccessibility(`Coach: ${caption}`);
    }
    lastCaption.current = caption;
  }, [props?.caption]);

  // The sent command shows until the mounted phone acts on it.
  useEffect(() => {
    if (sent === "start" && props && !props.canStart) setSent(null);
    if (sent === "stop" && props && !props.canStop) setSent(null);
  }, [sent, props]);

  const now = useNow(props?.stage === "counting" || props?.stage === "recording");

  if (!valid) return <Message title="Match not found" body="This link doesn't point to a match." onBack={() => router.back()} />;

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading the match" />
      </View>
    );
  }

  // A failed refresh keeps what's on screen and says so below; only a first load that fails shows this.
  if (!q.data) {
    const offline = isOfflineError(q.error);
    return (
      <Message
        title="Can't load the match"
        body={offline ? OFFLINE_MESSAGE : q.error instanceof Error ? q.error.message : "Something went wrong."}
        actionLabel="Try again"
        busy={q.isFetching}
        onAction={() => void q.refetch()}
        onBack={() => router.back()}
      />
    );
  }

  if (!props) {
    return (
      <Message
        title="Nothing recording"
        body="Nothing is recording this match right now. When the mounted phone starts setting up, it shows here and on your Lock Screen."
        onBack={() => router.back()}
      />
    );
  }

  const clock = liveClock(props, now);
  const stopped = props.stage === "stopped";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space4 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isLoading} onRefresh={() => void q.refetch()} tintColor={c.ink} />}
    >
      <View style={{ gap: spacing.space1 }}>
        <Text variant="headingL" accessibilityRole="header">
          Live match
        </Text>
        <Text variant="bodyStrong">{props.players}</Text>
      </View>

      <Card style={{ gap: spacing.space2 }}>
        <View
          accessible
          accessibilityLabel={[props.status, clock ? liveClockSpoken(props, now) : null].filter(Boolean).join(", ")}
          style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: spacing.space2 }}
        >
          <Text variant="title">{props.status}</Text>
          {clock ? (
            <Text variant="title" style={{ fontVariant: ["tabular-nums"] }}>
              {clock}
            </Text>
          ) : null}
        </View>
        <Text tone="inkMuted">{props.court}</Text>
        {props.battery ? <Text tone="inkMuted">Mounted phone {props.battery.toLowerCase()}</Text> : null}
      </Card>

      {props.caption ? (
        <Card style={{ gap: spacing.space1 }}>
          <Text variant="label" tone="inkMuted">
            Coach
          </Text>
          <Text variant="bodyStrong">{props.caption}</Text>
        </Card>
      ) : null}

      {q.isError ? (
        <Text tone="inkMuted" accessibilityLiveRegion="polite">
          Couldn't refresh. Still trying.
        </Text>
      ) : null}

      {actionNote ? (
        <Text tone="inkMuted" accessibilityRole="alert">
          {actionNote}
        </Text>
      ) : null}

      {sendError ? (
        <Text tone="danger" accessibilityRole="alert">
          {sendError}
        </Text>
      ) : null}

      {sent ? (
        <Text tone="inkMuted" accessibilityLiveRegion="polite">
          {sent === "start" ? "Starting on the mounted phone…" : "Stopping on the mounted phone…"}
        </Text>
      ) : null}

      <View style={{ gap: spacing.space2 }}>
        {props.canStart ? (
          <Button
            label="Start match"
            accessibilityHint="Starts recording on the mounted phone now"
            loading={sending === "start"}
            disabled={sent === "start"}
            onPress={() => void send("start")}
          />
        ) : null}
        {props.canStop ? (
          <Button
            label="Stop"
            variant="destructive"
            accessibilityLabel="Stop recording"
            accessibilityHint="Asks first, then the mounted phone stops and saves the match"
            loading={sending === "stop"}
            disabled={sent === "stop"}
            onPress={confirmStop}
          />
        ) : null}
        {stopped ? <Button label="Done" variant="secondary" onPress={() => router.back()} /> : null}
      </View>

      {!stopped ? (
        <Text variant="small" tone="inkMuted">
          Start match and Stop work the mounted phone from here. The voice coach plays only from the mounted phone.
        </Text>
      ) : null}
    </ScrollView>
  );
}

/** Ticks every second while a clock shows. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}

/** Can't load, nothing recording, or a bad link: words, a way out, and a retry where one helps. */
function Message({
  title,
  body,
  actionLabel,
  busy,
  onAction,
  onBack,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  busy?: boolean;
  onAction?: () => void;
  onBack: () => void;
}) {
  const c = useColors();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.paper }} contentContainerStyle={{ flexGrow: 1, padding: spacing.space4, gap: spacing.space4, justifyContent: "center" }}>
      <Text variant="headingL" accessibilityRole="header">
        {title}
      </Text>
      <Text tone="inkMuted">{body}</Text>
      {onAction && actionLabel ? <Button label={actionLabel} loading={busy} onPress={onAction} /> : null}
      <Button label="Back" variant={onAction ? "secondary" : "primary"} onPress={onBack} />
    </ScrollView>
  );
}
