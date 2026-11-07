// Add a court (F4; brief item 24). A name and an address with its ZIP. It's
// added to the directory for everyone, and picked for you: as your home
// court, or as the court of the open match you're posting. A bad address
// says what to fix. A bottom sheet by the sheet rule.

import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { AccessibilityInfo } from "react-native";

import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Field, Text } from "@/components/ui";
import { courtPick, useAddCourt, useSetHomeCourt } from "@/hooks/useCourts";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";

export default function AddCourtSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; name?: string }>();
  const mode = params.mode === "match" ? "match" : "home";
  const [name, setName] = useState(params.name ?? "");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useAddCourt();
  const setHome = useSetHomeCourt();
  const busy = add.isPending || setHome.isPending;
  const sheet = useSheetClose((name.trim() !== (params.name ?? "") || address.trim() !== "") && !busy);

  async function submit() {
    setError(null);
    try {
      const court = await add.mutateAsync({ name: name.trim(), address: address.trim() });
      if (mode === "home") await setHome.mutateAsync(court.courtId);
      else courtPick.set(court);
      AccessibilityInfo.announceForAccessibility(
        court.existing ? `${court.name} was already listed. Picked it.` : `${court.name} added and picked.`,
      );
      // Close this sheet and the list under it.
      sheet.finish(() => router.dismiss(2));
    } catch (e) {
      const message = isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Couldn't add the court. Try again.";
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    }
  }

  const ready = name.trim().length >= 2 && address.trim().length >= 5;

  return (
    <SheetBody title="Add a court" close={sheet.close}>
      <Field
        label="Name"
        value={name}
        onChangeText={(t) => setName(t.slice(0, 60))}
        placeholder="Beacon Courts"
        maxLength={60}
        returnKeyType="next"
      />
      <Field
        label="Address"
        value={address}
        onChangeText={(t) => {
          setAddress(t.slice(0, 120));
          setError(null);
        }}
        placeholder="Memorial Park, Beacon NY 12508"
        maxLength={120}
        autoComplete="street-address"
        textContentType="fullStreetAddress"
        returnKeyType="done"
        onSubmitEditing={() => ready && void submit()}
        error={!!error}
        hint={error ?? "Include the town and 5-digit ZIP."}
      />
      <Text tone="inkMuted">Players near you can pick it too. Others only see the name, address and an approximate distance.</Text>
      <Button label="Add court" onPress={() => void submit()} loading={busy} disabled={!ready} />
    </SheetBody>
  );
}
