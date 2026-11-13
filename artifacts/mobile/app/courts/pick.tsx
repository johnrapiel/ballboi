// The Court sheet (Wave 2 finding 51, canvas E4): the court directory in
// "match" mode, presented as a page sheet with the grabber and a left-aligned
// sheet title. Opened from Post an open match's court field and from a chat's
// Add a match. `chat=dm` when the chat is one-on-one.

import { useLocalSearchParams } from "expo-router";
import React from "react";

import { CourtsList } from "@/app/courts/index";

export default function CourtPickSheet() {
  const params = useLocalSearchParams<{ chat?: string }>();
  return <CourtsList mode="match" sheet chat={params.chat} />;
}
