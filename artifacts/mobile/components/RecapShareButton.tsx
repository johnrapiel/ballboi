import React, { useRef, useState } from "react";
import { Alert, Share, View } from "react-native";
import { captureRef } from "react-native-view-shot";

import { getGetMatchRecapQueryKey, useGetMatchRecap } from "@workspace/api-client-react";

import { DayLook } from "@/components/DayLook";
import { RecapImage } from "@/components/RecapImage";
import { Button } from "@/components/ui";
import { RECAP_SIZE, recapView } from "@/lib/recap";

// "Share recap" (spec decision 148): on the moment after entering a score and
// on Match detail. It draws the recap image off screen, saves it at 1080 x
// 1920, and opens the iOS share sheet with it (Instagram Stories, Messages,
// Save Image). VoiceOver hears what the image shows in the button's hint.

export function RecapShareButton({ matchId, variant = "secondary" }: { matchId: number; variant?: "primary" | "secondary" }) {
  const q = useGetMatchRecap(matchId, { query: { enabled: matchId > 0, queryKey: getGetMatchRecapQueryKey(matchId), staleTime: 0 } });
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const [busy, setBusy] = useState(false);
  const recap = q.data;

  async function share() {
    if (!recap || !ref.current || busy) return;
    setBusy(true);
    try {
      const uri = await captureRef(ref, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        width: RECAP_SIZE.width * RECAP_SIZE.scale,
        height: RECAP_SIZE.height * RECAP_SIZE.scale,
      });
      await Share.share({ url: uri });
    } catch {
      Alert.alert("Couldn't make the recap", "Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        label="Share recap"
        variant={variant}
        onPress={() => void share()}
        loading={busy || q.isLoading}
        disabled={!recap}
        accessibilityLabel="Share recap"
        accessibilityHint={recap ? `Opens the share sheet with an image. ${recapView(recap).description}` : "Opens the share sheet with an image of this match"}
      />
      {recap ? (
        // Drawn off screen only to be saved as the image; VoiceOver reads it from the button's hint.
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: "absolute", left: -10000, top: 0, width: RECAP_SIZE.width, height: RECAP_SIZE.height }}
        >
          <View ref={ref} collapsable={false}>
            {/* Always the Day look, even in Dark Mode (decision 144). */}
            <DayLook>
              <RecapImage recap={recap} />
            </DayLook>
          </View>
        </View>
      ) : null}
    </>
  );
}
