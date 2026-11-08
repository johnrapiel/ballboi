import React from "react";

import { SchemeOverride } from "@/hooks/useColors";

/**
 * Draws its children in the Day look (ivory and white, navy ink) even when
 * the iPhone is in Dark Mode. For shareable recaps only, which always use the
 * Day look (John, Nov 7 and 8). Everything else follows the phone.
 *
 * Everything inside that reads `useColors` or `useScheme` gets Day colors.
 * Native pieces that follow the window instead (Liquid Glass without a
 * `colorScheme`, keyboards, alerts) don't, so a recap shouldn't contain them.
 */
export function DayLook({ children }: { children: React.ReactNode }) {
  return <SchemeOverride.Provider value="light">{children}</SchemeOverride.Provider>;
}
