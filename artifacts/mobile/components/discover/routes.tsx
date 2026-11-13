// Discover's screens in the root stack, kept here so each Discover PR adds
// its own routes without touching app/_layout.tsx again.

import { Stack } from "expo-router";
import React from "react";

import { fullSheetOptions, grabberBarOptions, sheetOptions } from "@/components/Sheet";

type Header = Record<string, unknown>;

/** Root stack screens for Discover. `pushed` is the root layout's standard pushed header. */
export function discoverScreens(linen: string, pushed: Header, paper: string) {
  return [
    <Stack.Screen key="area" name="discover/area" options={sheetOptions(linen)} />,
    <Stack.Screen key="filters" name="discover/filters" options={sheetOptions(linen)} />,
    <Stack.Screen key="radius" name="discover/radius" options={sheetOptions(linen)} />,
    <Stack.Screen key="player" name="discover/player/[userId]" options={{ ...pushed, title: "" }} />,
    <Stack.Screen key="play" name="discover/play" options={{ ...pushed, title: "" }} />,
    <Stack.Screen key="availability" name="availability" options={{ ...pushed, title: "" }} />,
    <Stack.Screen key="league" name="discover/league/[leagueId]" options={{ ...pushed, title: "" }} />,
    <Stack.Screen key="request" name="discover/request/[leagueId]" options={sheetOptions(linen)} />,
    <Stack.Screen key="courts" name="courts/index" options={{ ...pushed, title: "Home court" }} />,
    // The Court sheet draws its own grabber and title (finding 51), so no header.
    <Stack.Screen key="court-pick" name="courts/pick" options={{ ...fullSheetOptions(linen), headerShown: false }} />,
    <Stack.Screen key="court-new" name="courts/new" options={sheetOptions(linen)} />,
    <Stack.Screen key="plan" name="discover/plan/[userId]" options={sheetOptions(linen)} />,
    <Stack.Screen key="match-new" name="discover/match/new" options={{ ...pushed, ...grabberBarOptions(paper), presentation: "modal", title: "Post an open match" }} />,
    <Stack.Screen key="match" name="discover/match/[id]" options={{ ...pushed, title: "" }} />,
    <Stack.Screen key="match-chat" name="discover/match/chat/[id]" options={{ ...pushed, title: "" }} />,
    <Stack.Screen key="match-players" name="discover/match/players/[id]" options={sheetOptions(linen)} />,
  ];
}
