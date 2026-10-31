import { useAuth } from "@clerk/expo";
import { Redirect, useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Linking, View } from "react-native";

import { Button, Card, Screen, Text, TextLink } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useAccountStatus, useSendAppeal } from "@/hooks/useAccountStatus";

// Shown instead of the app when an account is banned or suspended (spec:
// Enforcement ladder steps 5 and 6; checklist 3a "Bans stick", "One appeal by
// email"). The person can appeal once by email, sign out, or delete their
// account (5.1.1(v): deletion always stays available).

function longDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default function AccountBlockedScreen() {
  const c = useColors();
  const router = useRouter();
  const { signOut, isSignedIn } = useAuth();
  const status = useAccountStatus(!!isSignedIn);
  const sendAppeal = useSendAppeal();
  const [sending, setSending] = useState(false);

  if (!isSignedIn) return <Redirect href="/(auth)/welcome" />;
  if (status.isPending) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Checking your account" />
      </Screen>
    );
  }
  const s = status.data;
  if (!s || s.status === "ok") return <Redirect href="/(tabs)" />;

  const banned = s.status === "banned";
  const title = banned ? "Your account is banned" : "Your account is suspended";
  const body = banned
    ? "A moderator banned this account for breaking the community guidelines. You can't use Ball Boi or make a new account with the same Apple ID or email."
    : `A moderator suspended this account for breaking the community guidelines. You can use Ball Boi again on ${longDate(s.endsAt!)}.`;

  const openEmail = (reference: string | null) => {
    const subject = encodeURIComponent(reference ? `Appeal ${reference}` : "Account question");
    const mail = `mailto:${s.supportEmail}?subject=${subject}`;
    Linking.openURL(mail).catch(() =>
      Alert.alert("No email app", `Email ${s.supportEmail} with "Appeal ${reference ?? ""}" in the subject.`),
    );
  };

  const appeal = () => {
    Alert.alert(
      "Send your one appeal?",
      "You can appeal once. We'll open an email to support: say what happened and why the decision should change. We reply by email.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Write appeal",
          onPress: () => {
            setSending(true);
            sendAppeal()
              .then((r) => openEmail(r.reference))
              .catch((e: Error) => Alert.alert("Appeal not sent", e.message))
              .finally(() => setSending(false));
          },
        },
      ],
    );
  };

  return (
    <Screen style={{ justifyContent: "center", gap: spacing.space6 }}>
      <View style={{ gap: spacing.space3 }}>
        <Text variant="displayL" accessibilityRole="header">
          {title}
        </Text>
        <Text tone="inkMuted">{body}</Text>
      </View>

      {s.appeal ? (
        <Card style={{ gap: spacing.space2 }} accessible accessibilityLabel={appealSummary(s)}>
          <Text variant="bodyStrong">{s.appeal.outcome ? "Appeal decided" : "Appeal sent"}</Text>
          <Text tone="inkMuted">{appealSummary(s)}</Text>
        </Card>
      ) : null}

      <View style={{ gap: spacing.space3 }}>
        {s.canAppeal ? (
          <Button label="Appeal by email" loading={sending} onPress={appeal} accessibilityHint="You can appeal once" />
        ) : (
          <Text tone="inkMuted">
            Questions? Email{" "}
            <TextLink onPress={() => openEmail(null)} accessibilityLabel={`Email ${s.supportEmail}`}>
              {s.supportEmail}
            </TextLink>
            .
          </Text>
        )}
        <Button label="Sign out" variant="secondary" onPress={() => signOut()} />
        <Button label="Delete account" variant="destructive" onPress={() => router.push("/delete-account")} />
      </View>
    </Screen>
  );
}

function appealSummary(s: { appeal: { submittedAt: string; outcome: string | null } | null; appealReference: string | null }) {
  if (!s.appeal) return "";
  const sent = `You appealed on ${longDate(s.appeal.submittedAt)} (reference ${s.appealReference}).`;
  if (s.appeal.outcome === "upheld") return `${sent} A moderator reviewed it and kept the decision.`;
  return `${sent} We'll reply by email.`;
}
