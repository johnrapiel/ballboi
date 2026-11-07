// Your area (canvas W2_DiscoverZip, W2_DiscoverZipError; F5). Change the ZIP
// Discover searches from. It's your home area, so Profile shows the new one
// too. A ZIP we can't place says so and changes nothing. A bottom sheet by
// the sheet rule.

import React, { useState } from "react";
import { AccessibilityInfo } from "react-native";

import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Field, Text } from "@/components/ui";
import { useDiscoverMe, useSetDiscoverArea } from "@/hooks/useDiscover";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { isZip } from "@/lib/discover";

export default function AreaSheet() {
  const me = useDiscoverMe();
  const saved = me.data?.area?.zip ?? me.data?.homeZip ?? "";
  const [zip, setZip] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const save = useSetDiscoverArea();
  const dirty = zip !== saved;
  const sheet = useSheetClose(dirty && !save.isPending);

  async function submit() {
    const z = zip.trim();
    if (!isZip(z)) {
      setError("Enter the 5 digits of a US ZIP.");
      return;
    }
    if (z === saved) return sheet.finish();
    setError(null);
    try {
      const after = await save.mutateAsync(z);
      AccessibilityInfo.announceForAccessibility(`Area saved: ${after.area?.zip ?? z}${after.area ? `, ${after.area.town}` : ""}`);
      sheet.finish();
    } catch (e) {
      const message = isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Couldn't save your area. Try again.";
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    }
  }

  return (
    <SheetBody title="Your area" close={sheet.close}>
      <Field
        label="ZIP code"
        value={zip}
        onChangeText={(v) => {
          setZip(v.replace(/\D/g, "").slice(0, 5));
          setError(null);
        }}
        keyboardType="number-pad"
        maxLength={5}
        autoComplete="postal-code"
        textContentType="postalCode"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        autoFocus
        error={!!error}
        hint={error ?? "5 digits"}
      />
      <Text tone="inkMuted">
        Discover shows players, Open leagues and open matches near this ZIP. Changing it here also updates your profile. Others only ever
        see your town and an approximate distance.
      </Text>
      <Button label="Save" onPress={() => void submit()} loading={save.isPending} disabled={!isZip(zip)} />
    </SheetBody>
  );
}
