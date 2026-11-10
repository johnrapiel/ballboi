import * as Haptics from "expo-haptics";
import { Icon, type IconName } from "@/components/Icon";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Share, View } from "react-native";

import { PlainIconButton } from "@/components/Choice";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { copyText } from "@/lib/copy";
import { inviteMessage, joinUrl } from "@/lib/leagueInvite";

// The invite: the code, a copy icon and a share icon (approved canvas: Invite
// players; findings 11 and 12). Copy puts the join link on the clipboard
// (John, Nov 9), so a pasted invite opens the league, and says "Copied", out
// loud for VoiceOver too. Share sends the link with a line of text. The code
// stays on the card for people who type it in. It lives at
// the top of Manage league (finding 29) and on the invite screen after Create.
// A league with no code yet (one made before codes were automatic) gets a
// Create invite code button instead of an error.

function IconAction({ symbol, label, hint, onPress }: { symbol: IconName; label: string; hint: string; onPress: () => void }) {
  // In-page icon: plain brush icon, no circle (button standard, John, Nov 8).
  return <PlainIconButton symbol={symbol} label={label} hint={hint} onPress={onPress} />;
}

export function InviteCard({
  leagueName,
  code,
  loading,
  note,
  onRetry,
  onCreate,
  creating,
}: {
  onRetry?: () => void;
  /** The league has no active code (it loaded fine): offer to make one. */
  onCreate?: () => void;
  creating?: boolean;
  leagueName: string;
  code: string | null;
  loading?: boolean;
  /** One line under the code: who can join with it. */
  note?: string;
}) {
  const c = useColors();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function share() {
    if (!code) return;
    await Share.share({ message: inviteMessage(leagueName, code) }).catch(() => undefined);
  }

  async function copy() {
    if (!code) return;
    const ok = await copyText(joinUrl(code));
    if (!ok) {
      // An older development build without the clipboard: Share has Copy too.
      void share();
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    AccessibilityInfo.announceForAccessibility("Copied invite link");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2500);
  }

  return (
    <Card style={{ gap: spacing.space3 }}>
      <Text variant="section" tone="inkMuted" accessibilityRole="header">
        Invite players
      </Text>
      {loading ? (
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading invite code" />
      ) : code ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.space3 }}>
            <View
              accessible
              accessibilityLabel={`Invite code ${code.split("").join(" ")}`}
              style={{ flexGrow: 1, flexShrink: 1, minWidth: 140, gap: 2 }}
            >
              <Text variant="title" selectable style={{ fontFamily: "DMSans_600SemiBold", letterSpacing: 2, fontVariant: ["lining-nums", "tabular-nums"] }}>
                {code}
              </Text>
              <Text variant="small" tone="inkMuted">
                {joinUrl(code).replace(/^https:\/\//, "")}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.space2 }}>
              <IconAction symbol="doc.on.doc" label="Copy invite link" hint="Copies a link that opens the league" onPress={copy} />
              <IconAction symbol="square.and.arrow.up" label="Share invite link" hint="Opens the share sheet" onPress={share} />
            </View>
          </View>
          {copied ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space1 }}>
              <Icon name="checkmark" size={14} tintColor={c.ink} />
              <Text variant="small">Copied</Text>
            </View>
          ) : note ? (
            <Text variant="small" tone="inkMuted">
              {note}
            </Text>
          ) : null}
        </>
      ) : onCreate ? (
        <View style={{ gap: spacing.space2 }}>
          <Text variant="small" tone="inkMuted">
            This league doesn't have an invite code yet. Make one to share with players.
          </Text>
          <Button label="Create invite code" variant="secondary" loading={creating} onPress={onCreate} />
        </View>
      ) : (
        <View style={{ gap: spacing.space2 }}>
          <Text variant="small" tone="inkMuted">
            The invite code didn't load. Check your connection and try again.
          </Text>
          {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
        </View>
      )}
    </Card>
  );
}
