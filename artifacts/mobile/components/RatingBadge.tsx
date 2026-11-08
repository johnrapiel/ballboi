import React from "react";

import { Pill } from "@/components/ui";
import { formatRating, levelSpoken, type RatingSource } from "@/lib/onboarding";

/**
 * A player's level as a plain number pill, "3.5": outline only, no fill, and no
 * "Self-rated" label until NTRP or USTA levels exist (John, Nov 4 and Nov 6).
 * A verified level reads "3.5 Verified". VoiceOver reads "Level 3.5", so the
 * word "Level" is never lost.
 */
export function RatingBadge({ rating, source }: { rating: number; source: RatingSource }) {
  const value = formatRating(rating);
  return (
    <Pill
      label={source === "verified" ? `${value} Verified` : value}
      accessibilityLabel={levelSpoken(rating, source)}
    />
  );
}
