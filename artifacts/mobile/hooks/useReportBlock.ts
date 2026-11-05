// Report and block a player, from any screen that shows one.
// Spec: Messaging and moderation ("Report and block on every message",
// "Block stops DMs both ways and hides both players from each other in search
// and pairings"). App Store guideline 1.2.
//
// Standard iOS pattern: a native action sheet, then a native alert to confirm
// a block. Call `open(player)` from a "More" (ellipsis) button with
// accessibilityLabel "More options for <name>", or from a long-press menu.
// Plug in as screens land: player card, Discover results, message threads.

import { useAuth } from "@clerk/expo";
import { ActionSheetIOS, Alert, Platform } from "react-native";

import { apiErrorMessage, apiFetch } from "@/lib/api";

export interface ReportablePlayer {
  id: number;
  name: string;
  /** "player" (default): `id` is a league player id. "user": a Discover player's user id. */
  kind?: "player" | "user";
}

// Server reason codes (lib/db/src/schema/safety.ts) with plain labels.
export const REPORT_REASONS = [
  { code: "harassment", label: "Harassment or threats" },
  { code: "inappropriate_content", label: "Inappropriate photo or words" },
  { code: "impersonation", label: "Pretending to be someone else" },
  { code: "spam", label: "Spam" },
  { code: "cheating", label: "False scores or cheating" },
  { code: "other", label: "Something else" },
] as const;

export type ReportReasonCode = (typeof REPORT_REASONS)[number]["code"];

// What blocking really does, messages first, in the same words everywhere
// (block confirm, after blocking, Blocked players, unblock confirm). Blocks
// apply to messages both ways, Discover, Quick match opponents and Flex pairing; keep
// this in step with the server if that changes (Round robin is next).
export const BLOCK_EFFECTS =
  "You can't message each other or see each other in Discover, they don't show up as a Quick match opponent, and Flex leagues won't pair you.";
export const UNBLOCK_EFFECTS =
  "You'll be able to message each other and see each other in Discover again, they can show up as a Quick match opponent, and Flex leagues can pair you.";

/** Native action sheet on iOS; an Alert with buttons as the Android fallback. */
function choose(title: string, options: string[], destructiveIndex: number | undefined, onPick: (i: number) => void) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...options, "Cancel"], cancelButtonIndex: options.length, destructiveButtonIndex: destructiveIndex },
      (i) => {
        if (i < options.length) onPick(i);
      },
    );
    return;
  }
  Alert.alert(title, undefined, [
    ...options.map((o, i) => ({ text: o, onPress: () => onPick(i), style: i === destructiveIndex ? ("destructive" as const) : undefined })),
    { text: "Cancel", style: "cancel" as const },
  ]);
}

export function useReportBlock(opts: { onBlocked?: (player: ReportablePlayer) => void } = {}) {
  const { getToken } = useAuth();
  const { onBlocked } = opts;

  function report(player: ReportablePlayer, reason: ReportReasonCode) {
    apiFetch("/api/reports", getToken, {
      method: "POST",
      body: JSON.stringify({ targetType: "player", targetId: player.kind === "user" ? `user:${player.id}` : player.id, reason }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await apiErrorMessage(res, "We couldn't send your report. Try again."));
        Alert.alert("Report sent", "Thanks for letting us know. We review every report within 24 hours.", [
          { text: "OK" },
          { text: `Block ${player.name}`, style: "destructive", onPress: () => confirmBlock(player) },
        ]);
      })
      .catch((e: Error) => Alert.alert("Report not sent", e.message || "Check your connection and try again."));
  }

  function block(player: ReportablePlayer) {
    const path = player.kind === "user" ? `/api/discover/players/${player.id}/block` : `/api/players/${player.id}/block`;
    apiFetch(path, getToken, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await apiErrorMessage(res, "We couldn't block this player. Try again."));
        onBlocked?.(player);
        Alert.alert(`${player.name} is blocked`, BLOCK_EFFECTS);
      })
      .catch((e: Error) => Alert.alert("Not blocked", e.message || "Check your connection and try again."));
  }

  function confirmBlock(player: ReportablePlayer) {
    Alert.alert(
      `Block ${player.name}?`,
      `${BLOCK_EFFECTS} They aren't told.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Block", style: "destructive", onPress: () => block(player) },
      ],
    );
  }

  function chooseReason(player: ReportablePlayer) {
    choose(
      `Why are you reporting ${player.name}?`,
      REPORT_REASONS.map((r) => r.label),
      undefined,
      (i) => report(player, REPORT_REASONS[i].code),
    );
  }

  /** Shows "Report <name>" and "Block <name>". */
  function open(player: ReportablePlayer) {
    choose(player.name, [`Report ${player.name}`, `Block ${player.name}`], 1, (i) =>
      i === 0 ? chooseReason(player) : confirmBlock(player),
    );
  }

  return { open, report: chooseReason, block: confirmBlock };
}
