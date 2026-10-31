import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, Chip, Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useIsAdmin, useModerationActions, useReport, type Report } from "@/hooks/useModeration";
import { spokenTime } from "@/lib/messages";
import { ago, reasonLabel, sourceLabel } from "@/lib/moderation";

// One report (admin only): what was reported, the conversation snapshot, and
// the actions on the reported account. Spec: Enforcement ladder steps 3 to 5.
// Everything here is undoable except a ban, which can be lifted or overturned
// on appeal. Destructive actions are red and confirmed.

const SUSPEND_DAYS = [1, 7, 30] as const;

function statusLabel(status: Report["status"]) {
  return status === "open" ? "Open" : status === "actioned" ? "Action taken" : status === "dismissed" ? "Dismissed" : "Reviewed";
}

export default function ReportScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = Number(raw);
  const { isAdmin } = useIsAdmin();
  const q = useReport(isAdmin && Number.isInteger(id) ? id : null);
  const actions = useModerationActions();
  const [busy, setBusy] = useState<string | null>(null);

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: "Report",
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerTintColor: c.ink,
        headerStyle: { backgroundColor: c.paper },
        headerTitleStyle: { fontFamily: "DMSans_600SemiBold", color: c.ink },
      }}
    />
  );

  if (q.isPending || q.isError || !q.data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space6, alignItems: "center", gap: spacing.space4 }}>
        {header}
        {q.isError ? (
          <>
            <Text tone="inkMuted" style={{ textAlign: "center" }}>
              {q.error.message}
            </Text>
            <Button label="Try again" variant="secondary" onPress={() => void q.refetch()} />
          </>
        ) : (
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading report" />
        )}
      </View>
    );
  }

  const r = q.data;
  const who = r.subjectName ?? "this player";
  const subject = r.subjectClerkUserId;
  const reasonForRecord = `${reasonLabel(r.reason)} (report ${r.id})`;
  const reportedMessage = r.targetType === "message" ? r.snapshot?.messages.find((m) => m.reported) : undefined;
  const isAppeal = r.source === "appeal";

  const run = (key: string, task: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    task()
      .then(() => {
        if (done) Alert.alert("Done", done);
      })
      .catch((e: Error) => Alert.alert("Didn't work", e.message))
      .finally(() => setBusy(null));
  };

  /** Act on the account, then close the report as actioned. */
  const act = (key: string, task: () => Promise<unknown>, done: string) =>
    run(
      key,
      async () => {
        await task();
        if (r.status === "open") await actions.setReportStatus(r.id, "actioned");
      },
      done,
    );

  const hide = () =>
    Alert.alert("Hide this message?", `It disappears for both people in the conversation. You can unhide it later.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Hide message", style: "destructive", onPress: () => act("hide", () => actions.hideMessage(reportedMessage!.id), "Message hidden.") },
    ]);

  const restrict = () =>
    Alert.alert(
      `Restrict ${who}?`,
      "They can't start new conversations and their pending Message Requests are hidden, until you lift it.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Restrict", style: "destructive", onPress: () => act("restrict", () => actions.restrict(subject!, reasonForRecord, r.id), `${who} is restricted.`) },
      ],
    );

  const suspendFor = (days: number) =>
    Alert.alert(
      `Suspend ${who} for ${days === 1 ? "1 day" : `${days} days`}?`,
      "They can't use Ball Boi until it ends. They can appeal once by email.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Suspend",
          style: "destructive",
          onPress: () => act("suspend", () => actions.suspend(subject!, reasonForRecord, r.id, days), `${who} is suspended.`),
        },
      ],
    );

  const suspend = () => {
    const options = SUSPEND_DAYS.map((d) => (d === 1 ? "1 day" : `${d} days`));
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: `Suspend ${who} for how long?`, options: [...options, "Cancel"], cancelButtonIndex: options.length },
        (i) => {
          if (i < options.length) suspendFor(SUSPEND_DAYS[i]);
        },
      );
      return;
    }
    Alert.alert(`Suspend ${who} for how long?`, undefined, [
      ...SUSPEND_DAYS.map((d, i) => ({ text: options[i], onPress: () => suspendFor(d) })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  const ban = () =>
    Alert.alert(
      `Ban ${who}?`,
      "They can't use Ball Boi, and a new account with the same Apple ID or email is blocked too. They can appeal once by email.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Ban", style: "destructive", onPress: () => act("ban", () => actions.ban(subject!, reasonForRecord, r.id), `${who} is banned.`) },
      ],
    );

  const close = (status: "dismissed" | "reviewed") =>
    run(status, async () => {
      await actions.setReportStatus(r.id, status);
      router.back();
    });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space6 }}
    >
      {header}

      <View style={{ gap: spacing.space2 }}>
        <Chip label={statusLabel(r.status)} />
        <Text variant="title" accessibilityRole="header">
          {reasonLabel(r.reason)}
        </Text>
        <Text>About {who}</Text>
        <Text variant="small" tone="inkMuted">
          {sourceLabel(r.source)} · {ago(r.createdAt)}
        </Text>
        {r.details ? (
          <Card style={{ marginTop: spacing.space2 }}>
            <Text variant="label" tone="inkMuted" accessibilityRole="header">
              {r.source === "user" ? "Reporter's note" : "Details"}
            </Text>
            <Text style={{ marginTop: spacing.space1 }}>{r.details}</Text>
          </Card>
        ) : null}
      </View>

      {r.snapshot?.messages.length ? (
        <View style={{ gap: spacing.space2 }}>
          <Text variant="label" tone="inkMuted" accessibilityRole="header">
            Conversation at the time of the report
          </Text>
          {r.snapshot.messages.map((m) => (
            <View
              key={m.id}
              accessible
              accessibilityLabel={`${m.reported ? "Reported message. " : ""}${m.senderName}, ${m.text}. ${spokenTime(m.at)}`}
              style={{
                padding: spacing.space3,
                borderRadius: radius.radiusMd,
                borderWidth: m.reported ? 2 : 1,
                borderColor: m.reported ? c.danger : c.hairline,
                backgroundColor: c.linen,
                gap: 2,
              }}
            >
              <Text variant="small" tone={m.reported ? "danger" : "inkMuted"} style={{ fontFamily: "DMSans_600SemiBold" }}>
                {m.reported ? `Reported · ${m.senderName}` : m.senderName}
              </Text>
              <Text>{m.text}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {isAppeal ? (
        <Text tone="inkMuted">This is an appeal. Decide it in Moderation &gt; Appeals.</Text>
      ) : subject ? (
        <View style={{ gap: spacing.space3 }}>
          <Text variant="label" tone="inkMuted" accessibilityRole="header">
            Act on {who}
          </Text>
          {reportedMessage ? (
            <Button label="Hide message" variant="secondary" loading={busy === "hide"} disabled={!!busy} onPress={hide} />
          ) : null}
          <Button label="Restrict messaging" variant="secondary" loading={busy === "restrict"} disabled={!!busy} onPress={restrict} />
          <Button label="Suspend…" variant="destructive" loading={busy === "suspend"} disabled={!!busy} onPress={suspend} accessibilityLabel={`Suspend ${who}`} />
          <Button label="Ban" variant="destructive" loading={busy === "ban"} disabled={!!busy} onPress={ban} accessibilityLabel={`Ban ${who}`} />
        </View>
      ) : (
        <Text tone="inkMuted">This report isn't linked to an account, so there's no one to act on.</Text>
      )}

      {r.status === "open" ? (
        <View style={{ gap: spacing.space3 }}>
          <Text variant="label" tone="inkMuted" accessibilityRole="header">
            Close the report
          </Text>
          <Button label="Dismiss: no violation" variant="secondary" loading={busy === "dismissed"} disabled={!!busy} onPress={() => close("dismissed")} />
          <Button label="Mark reviewed" variant="secondary" loading={busy === "reviewed"} disabled={!!busy} onPress={() => close("reviewed")} />
        </View>
      ) : null}
    </ScrollView>
  );
}
