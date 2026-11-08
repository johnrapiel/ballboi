// The reason screen before the iOS notification prompt (decision 125). Opens
// once per phone, as a sheet, at the first of: joining a league, a match being
// added in chat, posting or joining an open match, or turning on open match
// alerts. Continue shows the iOS prompt. Apple asks that a screen before a
// permission prompt only leads to it, so there's no "Not now" button: drag
// down closes it like any sheet, and Ball Boi doesn't ask again either way.
// Until then, notifications arrive quietly in Notification Center.

import { useAuth } from "@clerk/expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";

import { SheetBody } from "@/components/Sheet";
import { Button, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import type { PromptTrigger } from "@/lib/notificationAccess";
import { requestFullNotifications } from "@/lib/notifications";

/** The first line, about what the player just did. */
const LEAD: Record<PromptTrigger, string> = {
  joinedLeague: "Hear when your league matches are set and when they're coming up.",
  matchInChat: "Hear when your match is coming up, and when they reply.",
  openMatch: "Hear when someone joins your match or writes in its chat.",
  matchAlerts: "Match alerts arrive as notifications.",
};

export const REASON_BODY = "Ball Boi also lets you know about new messages and reminds you before each match. iOS asks next.";

function leadFor(trigger: unknown): string {
  return typeof trigger === "string" && trigger in LEAD ? LEAD[trigger as PromptTrigger] : LEAD.joinedLeague;
}

export default function NotificationsReason() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { trigger } = useLocalSearchParams<{ trigger?: string }>();
  const [busy, setBusy] = useState(false);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  async function proceed() {
    if (busy) return;
    setBusy(true);
    try {
      await requestFullNotifications(getToken);
    } finally {
      setBusy(false);
      close();
    }
  }

  return (
    <SheetBody title="Turn on notifications" close={close}>
      <View style={{ gap: spacing.space2 }}>
        <Text>{leadFor(trigger)}</Text>
        <Text tone="inkMuted">{REASON_BODY}</Text>
      </View>
      <Button
        label="Continue"
        onPress={() => void proceed()}
        loading={busy}
        accessibilityHint="Shows the iOS notifications prompt"
      />
    </SheetBody>
  );
}
