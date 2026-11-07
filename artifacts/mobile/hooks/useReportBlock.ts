// Report a player, with block inside it, from any screen that shows one.
// Spec: Messaging and moderation ("Report and block on every message",
// "Block stops DMs both ways and hides both players from each other in search
// and pairings"). App Store guideline 1.2: a way to report, and a way to
// block, abusive users. Since Nov 6 (finding 20) block lives inside Report.
//
// Call `open(player)` from a "More" (ellipsis) button with accessibilityLabel
// "More options for <name>", or from a long-press menu. Plug in as screens
// land: player card, Discover results, message threads.

import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { AccessibilityInfo, Alert } from "react-native";

import { apiErrorMessage, apiFetch } from "@/lib/api";

export interface ReportablePlayer {
  /** Their league player id, when they have one. */
  id: number | null;
  /** Their account (users.id), for a Discover player with no league player yet. */
  userId?: number | null;
  name: string;
}

// The six reasons, in this order, everywhere a player can be reported (F9,
// Nov 7): server codes (lib/db/src/schema/safety.ts) with plain labels.
// "Something else" opens a required "Tell us what happened" field; the
// others have no note.
export const REPORT_REASONS = [
  { code: "harassment", label: "Harassment or threats" },
  { code: "inappropriate_content", label: "Inappropriate photo or words" },
  { code: "spam", label: "Spam" },
  { code: "cheating", label: "False scores or cheating" },
  { code: "unsafe", label: "Unsafe at a match" },
  { code: "other", label: "Something else" },
] as const;

export type ReportReasonCode = (typeof REPORT_REASONS)[number]["code"];

/** Labels for the Moderation screens, including reasons only older reports carry. */
export const REPORT_REASON_LABELS: { code: string; label: string }[] = [
  ...REPORT_REASONS,
  { code: "impersonation", label: "Pretending to be someone else" },
  { code: "no_show_dispute", label: "Disputed no-show" },
];

// What blocking really does, messages first, in the same words everywhere
// (the Report sheet's checkbox, after blocking, the unblock confirm). Blocks
// apply to messages both ways, Quick match opponents and Flex pairing; keep
// this in step with the server if that changes (Round robin is next).
export const BLOCK_EFFECTS = "You can't message each other, they don't show up as a Quick match opponent, and Flex leagues won't pair you.";
export const UNBLOCK_EFFECTS =
  "You'll be able to message each other again, they can show up as a Quick match opponent, and Flex leagues can pair you.";

export interface ReportTarget {
  /** Reporting one message in a conversation; otherwise the player. */
  conversationId?: number;
  messageId?: string;
}

/**
 * Report, with block inside it (John, Nov 6, finding 20). Report is the only
 * action anywhere a player shows: it opens the Report sheet
 * (app/report/[playerId].tsx), which has an "Also block [name]" checkbox.
 * There's no separate Block action. A blocked chat shows Unblock, which is
 * `unblock` here.
 */
export function useReportBlock() {
  const router = useRouter();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  /** Opens the Report sheet for a player, or for one of their messages. */
  function open(player: ReportablePlayer, target: ReportTarget = {}) {
    router.push({
      pathname: "/report/[playerId]",
      params: {
        // "u<userId>" for a Discover player with no league player record.
        playerId: player.id != null ? String(player.id) : `u${player.userId}`,
        name: player.name,
        ...(target.conversationId != null ? { conversationId: String(target.conversationId) } : {}),
        ...(target.messageId ? { messageId: target.messageId } : {}),
      },
    });
  }

  /** Asks, then unblocks. Resolves true when it's done. */
  function unblock(player: ReportablePlayer): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(`Unblock ${player.name}?`, UNBLOCK_EFFECTS, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Unblock",
          onPress: () =>
            // By league player, else by account (a Discover player).
            (player.id != null
              ? apiFetch(`/api/players/${player.id}/block`, getToken, { method: "DELETE" })
              : apiFetch(`/api/discover/players/${player.userId}/block`, getToken, { method: "DELETE" }))
              .then(async (res) => {
                if (!res.ok) throw new Error(await apiErrorMessage(res, "We couldn't unblock this player. Try again."));
                await queryClient.invalidateQueries({ queryKey: ["messages"] });
                AccessibilityInfo.announceForAccessibility(`${player.name} is unblocked`);
                resolve(true);
              })
              .catch((e: Error) => {
                Alert.alert("Not unblocked", e.message || "Check your connection and try again.");
                resolve(false);
              }),
        },
      ]);
    });
  }

  return { open, report: open, unblock };
}
