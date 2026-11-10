import { Icon } from "@/components/Icon";
import { useRouter, type Href } from "expo-router";
import React from "react";
import { Linking, Pressable, View, type AccessibilityActionEvent } from "react-native";

import { Text, TextLink } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import type { Segment } from "@/lib/leagueChat";
import { linkActionLabel, linkParts, linkTarget } from "@/lib/messageLinks";
import { shortTime, spokenTime } from "@/lib/messages";

export type BubbleStatus = "sent" | "sending" | "failed";

/** A piece of a message: plain text, an @mention (bold) or a link. */
type Part = { text: string; mention: boolean; url?: string };

export interface BubbleProps {
  text: string;
  at: string;
  fromMe: boolean;
  /** Who sent it, for VoiceOver: "You" or the other player's name. */
  senderName: string;
  status?: BubbleStatus;
  /** Their messages: Report, from a long press or a VoiceOver action. Block is inside Report (finding 20). */
  onReport?: () => void;
  /** Long press on their message: the action sheet with Report message. */
  onLongPress?: () => void;
  /** Your failed message: send it again. */
  onRetry?: () => void;
  /** League chats: the text split so @mentions show in bold. */
  segments?: Segment[];
  /** League chats: what VoiceOver reads before the time, with the Admin label and mentions (lib/leagueChat). */
  spoken?: string;
  /** League chats: the long-press menu as a VoiceOver action too, for admins' pins and moderation. */
  onMore?: () => void;
}

/**
 * One message. VoiceOver reads sender, text and time in one swipe. Report is
 * a VoiceOver custom action as well as a long press, and a failed
 * send says so in words, not just with a red icon.
 *
 * Links (http, https and ballboi.tennis) are underlined and tappable: a Ball
 * Boi link the app has a screen for opens in the app, anything else in
 * Safari. VoiceOver hears "link" and gets an Open link action for each one.
 */
export function MessageBubble({
  text,
  at,
  fromMe,
  senderName,
  status = "sent",
  onReport,
  onLongPress,
  onRetry,
  segments,
  spoken: spokenText,
  onMore,
}: BubbleProps) {
  const c = useColors();
  const router = useRouter();
  const failed = status === "failed";
  const sending = status === "sending";

  // Mentions (league chats) first, then links inside the plain parts.
  const parts: Part[] = (segments ?? [{ text, mention: false }]).flatMap((seg): Part[] =>
    seg.mention ? [{ text: seg.text, mention: true }] : linkParts(seg.text).map((p) => ({ ...p, mention: false })),
  );
  // Links work once the message is sent; a pending one is still just text.
  const links = failed || sending ? [] : parts.flatMap((p) => (p.url ? [p.url] : []));

  const open = (url: string) => {
    const target = linkTarget(url);
    if (target.kind === "app") router.push(target.path as Href);
    else void Linking.openURL(target.url).catch(() => undefined);
  };

  const spoken = [
    spokenText ?? `${senderName}, ${text}`,
    sending ? "Sending" : failed ? "Not sent. Tap to retry" : spokenTime(at),
  ].join(". ");

  const actions = [
    ...links.map((url, i) => ({ name: `link-${i}`, label: linkActionLabel(url) })),
    ...(onReport ? [{ name: "report", label: "Report message" }] : []),
    ...(onMore ? [{ name: "more", label: "More actions" }] : []),
  ];
  // One link: the whole message reads as a link and a double-tap opens it.
  const oneLink = links.length === 1 ? links[0] : null;

  const onAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === "report") onReport?.();
    if (name === "more") onMore?.();
    if (name === "activate") {
      if (failed) onRetry?.();
      else if (oneLink) open(oneLink);
    }
    if (name.startsWith("link-")) {
      const url = links[Number(name.slice(5))];
      if (url) open(url);
    }
  };

  return (
    <View style={{ alignItems: fromMe ? "flex-end" : "flex-start", paddingHorizontal: spacing.space4, paddingVertical: 3 }}>
      <Pressable
        accessible
        accessibilityLabel={spoken}
        accessibilityRole={failed ? "button" : oneLink ? "link" : undefined}
        accessibilityActions={failed ? [{ name: "activate" }] : oneLink ? [{ name: "activate" }, ...actions] : actions}
        onAccessibilityAction={onAction}
        onPress={failed ? onRetry : undefined}
        onLongPress={!fromMe || onMore ? onLongPress : undefined}
        delayLongPress={350}
        style={({ pressed }) => ({ maxWidth: "82%", opacity: pressed ? 0.8 : sending ? 0.7 : 1 })}
      >
        <View
          style={{
            paddingHorizontal: spacing.space3,
            paddingVertical: spacing.space2,
            borderRadius: radius.radiusLg,
            borderBottomRightRadius: fromMe ? radius.radiusSm : radius.radiusLg,
            borderBottomLeftRadius: fromMe ? radius.radiusLg : radius.radiusSm,
            backgroundColor: fromMe ? c.ink : c.linen,
            borderWidth: fromMe ? 0 : 1,
            borderColor: c.hairline,
          }}
        >
          {/* Selectable text on iOS swallows taps on links inside it, so a message with links isn't selectable. */}
          <Text tone={fromMe ? "onInk" : "ink"} selectable={!failed && !links.length}>
            {parts.map((part, i) =>
              part.mention ? (
                <Text key={i} variant="bodyStrong" tone={fromMe ? "onInk" : "ink"}>
                  {part.text}
                </Text>
              ) : part.url && links.length ? (
                // Underlined on both bubbles; on your own (ink) bubble the link stays on-ink for contrast.
                <TextLink key={i} onPress={() => open(part.url!)} style={fromMe ? { color: c.onInk } : undefined}>
                  {part.text}
                </TextLink>
              ) : (
                part.text
              ),
            )}
          </Text>
        </View>
        {failed ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.space1, marginTop: spacing.space1, minHeight: 24 }}>
            <Icon name="exclamationmark.circle" size={14} tintColor={c.danger} />
            <Text variant="small" tone="danger">
              Not sent. Tap to retry
            </Text>
          </View>
        ) : (
          <Text variant="small" tone="inkMuted" style={{ marginTop: 2, textAlign: fromMe ? "right" : "left" }}>
            {sending ? "Sending…" : shortTime(at)}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
