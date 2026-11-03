import React from "react";
import { Switch, type SwitchProps } from "react-native";

import { useColors } from "@/hooks/useColors";

export interface ToggleProps extends Omit<
  SwitchProps,
  "trackColor" | "thumbColor" | "ios_backgroundColor"
> {
  /** Required: VoiceOver reads it with the on/off state. */
  accessibilityLabel: string;
}

/**
 * The one toggle used across Ball Boi. Use it instead of a raw Switch.
 *
 * On: navy (`ink`) track, knob in `onInk`, so the knob always contrasts with
 * the track (white on navy by day, navy on cream at night, 15:1 or better).
 * The default white knob vanished on the cream Night track (1.2:1).
 * Off: `hairlineStrong` track, which clears 3:1 against linen and paper in
 * both themes (WCAG 1.4.11). The knob's position is the non-color signal.
 * Increase Contrast swaps in the -hc hairline through useColors.
 */
export function Toggle(props: ToggleProps) {
  const c = useColors();
  return (
    <Switch
      {...props}
      trackColor={{ true: c.ink, false: c.hairlineStrong }}
      thumbColor={c.onInk}
      ios_backgroundColor={c.hairlineStrong}
    />
  );
}
