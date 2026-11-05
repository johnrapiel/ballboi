// Report a court in the directory (spec: Discover > Court directory; App Store
// guideline 1.2 for anything players add). A native action sheet with the
// reasons, then a thank-you. Nothing changes until a moderator looks.

import { useCreateReport } from "@workspace/api-client-react";
import { ActionSheetIOS, Alert, Platform } from "react-native";

// Plain labels on the server's reason codes (lib/db/src/schema/safety.ts).
const COURT_REASONS = [
  { code: "other", label: "It isn't there or isn't a tennis court" },
  { code: "inappropriate_content", label: "Inappropriate name" },
  { code: "spam", label: "Spam" },
] as const;

export function useReportCourt() {
  const create = useCreateReport();

  const send = (courtId: number, reason: (typeof COURT_REASONS)[number]["code"]) =>
    create.mutate(
      { data: { targetType: "court", targetId: String(courtId), reason } },
      {
        onSuccess: () => Alert.alert("Report sent", "Thanks for letting us know. We review every report within 24 hours."),
        onError: () => Alert.alert("Report not sent", "Check your connection and try again."),
      },
    );

  /** Opens the reasons for one court. */
  return (court: { courtId: number; name: string }) => {
    const title = `Report ${court.name}`;
    const labels = COURT_REASONS.map((r) => r.label);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ title, options: [...labels, "Cancel"], cancelButtonIndex: labels.length }, (i) => {
        if (i < labels.length) send(court.courtId, COURT_REASONS[i].code);
      });
      return;
    }
    Alert.alert(title, undefined, [
      ...COURT_REASONS.map((r) => ({ text: r.label, onPress: () => send(court.courtId, r.code) })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };
}
