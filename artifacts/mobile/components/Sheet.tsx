// The one bottom sheet (design system README, Bottom sheets; John, Nov 6,
// finding 9). Every sheet:
// - hugs its content and grows with larger text, scrolling only when it's
//   taller than the screen (the route uses `sheetOptions` from here). It has
//   one position, its content's height, with the primary action one gap above
//   the home indicator: no taller position over blank space. The
//   one exception is New league, a full-height page sheet (`fullSheetOptions`),
// - shows the grabber bar at the top (decision 181). Hugging sheets get the
//   system one; full-height page sheets and the other swipe-down modals get
//   `Grabber`, drawn to match it,
// - has a Close button: a brush X in the 44pt glass corner circle at the top
//   left, on the same row as the title (Wave 2 finding 50, decision 198).
//   Drag down still closes it too, and so does the VoiceOver escape gesture.
//   All three go the same way: if something would be lost, it asks
//   "Discard changes?" first; if not, it closes at once. This replaced the
//   old "no Cancel" rule (#214),
// - has a left-aligned title beside the X, read as the header,
// - ends on its primary action.

import React, { useEffect, useState } from "react";
import { Keyboard, ScrollView, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CornerButton } from "@/components/CornerButton";
import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { keyboardCover } from "@/lib/keyboardCover";

/** Stack options for a sheet route that hugs its content. */
export function sheetOptions(linen: string) {
  return {
    headerShown: false,
    presentation: "formSheet" as const,
    // One position, the content's height (finding 46). Scrolling inside a
    // sheet that outgrew the screen never stretches it to another one.
    sheetAllowedDetents: "fitToContents" as const,
    sheetExpandsWhenScrolledToEdge: false,
    sheetGrabberVisible: true,
    sheetCornerRadius: radius.radiusLg,
    contentStyle: { backgroundColor: linen },
  };
}

/**
 * Stack options for a full-height form (New league), used with `SheetBody fill`:
 * the standard iOS page sheet, the same presentation as Mail's New Message.
 * It slides up to just under the status bar, the screen behind shows above
 * it, and it closes with its Close (X) or a drag down.
 *
 * Not a formSheet: react-native-screens lays a formSheet's content out in an
 * absolutely positioned box with no bottom edge, and on iOS 26 wraps it in a
 * `flex: 1` safe area view, which has zero height inside that box. A plain
 * View still draws past it (the hugging sheets, the pinned button), but the
 * ScrollView of a full-height form drew nothing (New league, builds 21 and
 * 22). A page sheet gets its size from iOS and fills it with `flex: 1`, like
 * every pushed screen and the other modals in the app.
 */
export function fullSheetOptions(linen: string) {
  return {
    ...grabberOptions(),
    presentation: "modal" as const,
    contentStyle: { backgroundColor: linen },
  };
}

// The grabber bar (decision 181, John, Nov 11): every sheet you can swipe down
// shows it, so people know they can. iOS draws it only on the hugging
// formSheets; a page sheet ("modal") has none, so it's drawn here to match
// the system one: 36 by 5pt, fully round, 5pt from the top edge, centred.
// It's `hairline-strong` (3:1 or better on paper and linen, Day and Night,
// and stronger with Increase Contrast), a little firmer than the system gray
// so it clears the non-text contrast bar. VoiceOver skips it: every one of
// these screens has the Close button (`SheetClose`), so swipe down isn't the
// only way.
const GRABBER = { width: 36, height: 5, top: 5 } as const;

/** The grabber bar itself, centred in a strip at the top of the sheet. */
export function Grabber() {
  const c = useColors();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: GRABBER.top + GRABBER.height, alignItems: "center" }}
    >
      <View
        style={{
          marginTop: GRABBER.top,
          width: GRABBER.width,
          height: GRABBER.height,
          borderRadius: radius.radiusPill,
          backgroundColor: c.hairlineStrong,
        }}
      />
    </View>
  );
}

/**
 * The sheet's Close button (Wave 2 finding 50, decision 198): a brush X in the
 * 44pt corner circle (the same glass as the tab corners), at the top left of
 * every sheet, on the title's row. It's the non-gesture way to do what swipe
 * down does, so pass the same guarded close: it asks "Discard changes?" when
 * something would be lost. Sheets with a native navigation bar (Quick match,
 * Post an open match) use `HeaderIconButton` with "xmark" in `headerLeft`
 * instead, where iOS draws the glass.
 */
export function SheetClose({ onPress, hint }: { onPress: () => void; hint?: string }) {
  return <CornerButton symbol="xmark" label="Close" hint={hint} onPress={onPress} />;
}

/**
 * The Close button on its own row at the top of a swipe-down modal whose title
 * sits lower down (Join league's invite card, a recorded match's invite).
 * Below the grabber strip, with the screen's side margin.
 */
export function SheetCloseBar({ onPress }: { onPress: () => void }) {
  return (
    <View
      style={{
        paddingHorizontal: spacing.space4,
        paddingTop: spacing.space3,
        alignItems: "flex-start",
      }}
    >
      <SheetClose onPress={onPress} />
    </View>
  );
}

/**
 * Stack options that add the grabber to a swipe-down modal with no navigation
 * bar (New league, Join league, a recorded match's invite). It floats over the
 * top of the screen like the system grabber, in the top 10pt, above where any
 * of these screens starts its content, so it never covers a title or a button.
 */
export function grabberOptions() {
  return {
    headerShown: true,
    headerTransparent: true,
    header: () => <Grabber />,
  };
}

/**
 * Stack options that add the grabber to a swipe-down modal that keeps its
 * navigation bar (Quick match, Post an open match). The bar goes transparent
 * and draws on a `paper` background with the grabber above the title.
 */
export function grabberBarOptions(paper: string) {
  return {
    headerStyle: { backgroundColor: "transparent" },
    headerBackground: () => (
      <View style={{ flex: 1, backgroundColor: paper }}>
        <Grabber />
      </View>
    ),
  };
}

/**
 * Closing a sheet. While `dirty`, drag down, the escape gesture and `close()`
 * ask "Discard changes?" first. `finish()` closes without asking, for after a
 * save; `finish(go)` runs `go` instead of going back (a sheet that opens the
 * next screen in its place).
 */
export function useSheetClose(dirty: boolean) {
  return useDiscardGuard(dirty, {
    title: "Discard changes?",
    message: "What you entered in this sheet won't be saved.",
  });
}

export function SheetBody({
  title,
  dirty = false,
  close,
  fill = false,
  footer,
  children,
  contentStyle,
  scrollRef,
  titleAction,
  closeButton = true,
}: {
  title: string;
  /**
   * Show the Close (X). Only the notifications pre-prompt turns it off: App
   * Review wants a screen before a permission prompt to lead only to it.
   */
  closeButton?: boolean;
  /** A small icon button at the right end of the title line, like Free times' pencil. */
  titleAction?: React.ReactNode;
  /** Something was typed or picked: closing asks first. Ignored when `close` is passed. */
  dirty?: boolean;
  /** The sheet's own close, from `useSheetClose`, when the screen also needs `finish`. */
  close?: () => void;
  /** Fill a full-height page sheet (New league, route uses `fullSheetOptions`). Otherwise the sheet hugs its content. */
  fill?: boolean;
  /** Pinned under the scrolling content, like a full-height form's primary button. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  scrollRef?: React.Ref<React.ComponentRef<typeof ScrollView>>;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const own = useSheetClose(close ? false : dirty);
  // Close (X), drag down and the VoiceOver escape all end up here.
  const onEscape = close ?? own.close;

  // Hugging sheets (Wave 1 Fix 1b): the native `fitToContents` sheet sizes
  // itself from its content, and it only measures that reliably when the
  // content is a plain View with a definite height. A ScrollView with
  // `flexGrow: 0` and `maxHeight` left the sheet blank on iOS 26. So the
  // content is a plain View, and only when it's taller than the screen (very
  // large text) does it switch to a ScrollView with a fixed height. Once a
  // sheet scrolls it keeps scrolling until it closes, so it never flips back
  // and forth while someone types.
  //
  // iOS sizes a hugging sheet as "content height + the home indicator area":
  // a custom detent is measured from the bottom safe area, and the system
  // adds that strip below it in the sheet's own background (Wave 2 finding
  // 46). So a hugging sheet never pads for the home indicator itself; doing
  // so left a second, empty home-indicator gap under Send. `homeIndicator`
  // is the safe area only a full-height page sheet has to clear itself.
  const homeIndicator = fill ? insets.bottom : 0;
  const maxHeight = height - insets.top - insets.bottom - spacing.space6;
  const [contentH, setContentH] = useState(0);
  const [footerH, setFooterH] = useState(0);
  const [tall, setTall] = useState(false);
  useEffect(() => {
    if (!fill && !tall && contentH + footerH > maxHeight) setTall(true);
  }, [fill, tall, contentH, footerH, maxHeight]);
  const scrolls = fill || tall;

  // Full-height page sheet (New league, `fullSheetOptions`). iOS sizes the
  // page sheet, so the root fills it with `flex: 1`. While the keyboard is up
  // the root leaves room for it at the bottom, so the pinned button sits just
  // above it and the form scrolls in the space above.
  const keyboardH = useKeyboardHeight(fill);

  const padding: StyleProp<ViewStyle> = [
    {
      // The title row is the 44pt Close circle tall, so a little less above it
      // keeps the title where it was under the grabber.
      paddingTop: spacing.space4,
      paddingHorizontal: spacing.space4,
      paddingBottom: footer ? spacing.space4 : homeIndicator + spacing.space4,
      gap: spacing.space4,
    },
    contentStyle,
  ];
  // Close (X) at the top left, the title beside it, and the optional title
  // action at the right end. It closes the way drag down does: through the
  // guard, so it asks before discarding anything.
  const content = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: MIN_TAP }}>
        {closeButton ? <SheetClose onPress={onEscape} /> : null}
        <Text variant="headingM" accessibilityRole="header" style={{ flex: 1 }}>
          {title}
        </Text>
        {titleAction}
      </View>
      {children}
    </>
  );

  return (
    <View
      // The VoiceOver escape gesture (two-finger Z) closes the sheet.
      onAccessibilityEscape={onEscape}
      style={[{ backgroundColor: c.linen }, fill ? { flex: 1, paddingBottom: keyboardH } : null]}
    >
      {scrolls ? (
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          // Full-height sheet: fills the root above the footer. A hugging
          // sheet that outgrew the screen gets a fixed height so the native
          // sheet can still measure it.
          style={fill ? { flex: 1 } : { height: Math.max(0, maxHeight - footerH) }}
          contentContainerStyle={padding}
        >
          {content}
        </ScrollView>
      ) : (
        <View onLayout={(e) => setContentH(e.nativeEvent.layout.height)} style={padding}>
          {content}
        </View>
      )}
      {footer ? (
        <View
          onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          style={{
            paddingHorizontal: spacing.space4,
            paddingTop: spacing.space3,
            // Over the keyboard there's no home indicator to clear.
            paddingBottom: (keyboardH > 0 ? 0 : homeIndicator) + spacing.space3,
            borderTopWidth: 1,
            borderTopColor: c.hairline,
            backgroundColor: c.linen,
            gap: spacing.space2,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

/**
 * How much of the screen the keyboard covers, in points, for a full-height
 * sheet (0 when it's down, or when `on` is false). Measured from the bottom of
 * the window, so a floating or split keyboard that covers nothing counts as 0.
 */
function useKeyboardHeight(on: boolean) {
  const { height } = useWindowDimensions();
  const [covered, setCovered] = useState(0);
  useEffect(() => {
    if (!on) return;
    const onFrame = (e: { endCoordinates: { screenY: number } }) => setCovered(keyboardCover(height, e.endCoordinates.screenY));
    const show = Keyboard.addListener("keyboardWillShow", onFrame);
    const change = Keyboard.addListener("keyboardWillChangeFrame", onFrame);
    const hide = Keyboard.addListener("keyboardWillHide", () => setCovered(0));
    // The Name field's autoFocus can raise the keyboard before this subscribes.
    const now = Keyboard.metrics();
    if (now) setCovered(keyboardCover(height, now.screenY));
    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, [on, height]);
  return on ? covered : 0;
}
