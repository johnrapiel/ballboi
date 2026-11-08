// My matches stopped being its own screen (decision 138, John, Nov 8): your
// matches live on Profile, under Upcoming matches and Results. Any link,
// deep link or push to /matches lands there, on the tab it asked for.

import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";

import { tabFromParam } from "@/lib/playerCard";

export default function MyMatchesRedirect() {
  const params = useLocalSearchParams<{ tab?: string }>();
  return <Redirect href={{ pathname: "/(tabs)/profile", params: { tab: tabFromParam(params.tab) ?? "upcoming", at: String(Date.now()) } }} />;
}
