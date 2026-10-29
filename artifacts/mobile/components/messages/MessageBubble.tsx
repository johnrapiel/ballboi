import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, View, type AccessibilityActionEvent } from "react-native";

import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { shortTime, spokenTime } from "@/lib/messages";

export type BubbleStatus = "sent" | "sending" | "failed";

export interface BubbleProps {
  text: string;
  at: string;
  fromMe: boolean;
  /** Who sent it, for VoiceOver: "You" or the other player's name. */
  senderName: string;
  status?: BubbleStatus;
  /** Their messages: report and block, from a long press or VoiceOver actions. */
  onReport?: () => void;
  onBlock?: () => void;
  /** Long press on their message: the action sheet with the same choices. */
  onLongPress?: () => void;
  /** Your failed message: send it again. */
  onRetry?: () => void;
  blockLabel?: string;
}

/**
 * One message. VoiceOver reads sender, text and time in one swipe. Report and
 * block are VoiceOver custom actions as well as a long press, and a failed
 * send says so in words, not just with a red icon.
 */
export function MessageBubble({
  text,
  at,
  fromMe,
  senderName,
  status = "sent",
  onReport,
  onBlock,
  onLongPress,
  onRetry,
  blockLabel,
}: BubbleProps) {
  const c = useColors();
  const failed = status === "failed";
  const sending = status === "sending";

  const spoken = [
    `${senderName}, ${text}`,
    sending ? "Sending" : failed ? "Not sent. Tap to retry" : spokenTime(at),
  ].join(". ");

  const actions = [
    ...(onReport ? [{ name: "report", label: "Report message" }] : []),
    ...(onBlock ? [{ name: "block", label: blockLabel ?? "Block" }] : []),
  ];

  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "report") onReport?.();
    if (e.nativeEvent.actionName === "block") onBlock?.();
    if (e.nativeEvent.actionName === "activate") onRetry?.();
  };

  return (
    <View style={{ alignItems: fromMe ? "flex-end" : "flex-start", paddingHorizontal: spacing.space4, paddingVertical: 3 }}>
      <Pressable
        accessible
        accessibilityLabel={spoken}
        accessibilityRole={failed ? "button" : undefined}
        accessibilityActions={failed ? [{ name: "activate" }] : actions}
        onAccessibilityAction={onAction}
        onPress={failed ? onRetry : undefined}
        onLongPress={!fromMe ? onLongPress : undefined}
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
          <Text tone={fromMe ? "onInk" : "ink"} selectable={!failed}>
            {text}
          </Text>
        </View>
        {failed ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.space1, marginTop: spacing.space1, minHeight: 24 }}>
            <SymbolView name="exclamationmark.circle" size={14} tintColor={c.danger} />
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
