import React, { useEffect } from "react";
import { AccessibilityInfo, Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { Icon } from "@/components/Icon";
import { Text } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import type { PullToRefresh } from "@/hooks/usePullToRefresh";
import { textTapSlop } from "@/lib/tapTarget";
import { FAILED_NOTICE_TEXT, OFFLINE_NOTICE_TEXT } from "@/lib/pullRefresh";

/**
 * The quiet line at the top of a screen when a refresh failed but there's
 * still something to show (Wave 2 finding 41, decision 195). The screen keeps
 * its data; this says it may be old. Offline: "You're offline. Showing what
 * was here earlier." Anything else: "Couldn't refresh. …" with Try again.
 * It goes away by itself when a refresh works (usePullToRefresh).
 *
 * An icon and words, never color alone. Same look and padding as the
 * notifications-off line on Home: sand, `space-4` on every side (decision
 * 192). VoiceOver hears it once when it appears.
 *
 *   <OfflineNotice pull={pull} />
 */
export function OfflineNotice({
  pull,
  style,
}: {
  pull: Pick<PullToRefresh, "notice" | "retry" | "retrying">;
  /** Outside spacing only, for lists whose header has no padding of its own. */
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const { notice, retry, retrying } = pull;
  const text = notice === "offline" ? OFFLINE_NOTICE_TEXT : FAILED_NOTICE_TEXT;

  useEffect(() => {
    if (notice) AccessibilityInfo.announceForAccessibility(notice === "offline" ? OFFLINE_NOTICE_TEXT : FAILED_NOTICE_TEXT);
  }, [notice]);

  if (!notice) return null;
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.space3,
          // Equal padding, one token (decision 192).
          padding: spacing.space4,
          backgroundColor: c.sand,
          borderRadius: radius.radiusMd,
        },
        style,
      ]}
    >
      <Icon name={notice === "offline" ? "wifi.slash" : "exclamationmark.circle"} size={20} tintColor={c.ink} />
      <View style={{ flex: 1, gap: spacing.space2 }}>
        <Text variant="small" accessibilityRole="text">
          {text}
        </Text>
        {notice === "failed" ? (
          <Pressable
            onPress={retry}
            disabled={retrying}
            accessibilityRole="link"
            accessibilityLabel="Try again"
            accessibilityState={{ disabled: retrying, busy: retrying }}
            hitSlop={textTapSlop("small")}
            style={({ pressed }) => ({ alignSelf: "flex-start", opacity: retrying ? 0.5 : pressed ? 0.6 : 1 })}
          >
            <Text variant="small" style={{ textDecorationLine: "underline" }}>
              {retrying ? "Trying again…" : "Try again"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
