import { type IconName } from "@/components/Icon";
import React from "react";
import { ActivityIndicator, Share, View } from "react-native";

import { PlainIconButton } from "@/components/Choice";
import { CopyButton } from "@/components/CopyButton";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { inviteMessage, joinUrl } from "@/lib/leagueInvite";

// The invite: the code, a copy icon and a share icon (approved canvas: Invite
// players; findings 11 and 12). Copy puts the join link on the clipboard
// (John, Nov 9), so a pasted invite opens the league; the copy icon turns
// into a check for about 2 seconds (CopyButton, finding 22). Share sends the link with a line of text. The code
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
  async function share() {
    if (!code) return;
    await Share.share({ message: inviteMessage(leagueName, code) }).catch(() => undefined);
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
              <CopyButton
                text={joinUrl(code)}
                label="Copy invite link"
                copiedLabel="Copied invite link"
                hint="Copies a link that opens the league"
                // An older development build without the clipboard: Share has Copy too.
                onFail={() => void share()}
              />
              <IconAction symbol="square.and.arrow.up" label="Share invite link" hint="Opens the share sheet" onPress={share} />
            </View>
          </View>
          {note ? (
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
