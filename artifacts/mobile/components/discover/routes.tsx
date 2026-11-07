// Discover's screens in the root stack, kept here so each Discover PR adds
// its own routes without touching app/_layout.tsx again.

import { Stack } from "expo-router";
import React from "react";

import { sheetOptions } from "@/components/Sheet";

type Header = Record<string, unknown>;

/** Root stack screens for Discover. `pushed` is the root layout's standard pushed header. */
export function discoverScreens(linen: string, pushed: Header) {
  return [
    <Stack.Screen key="area" name="discover/area" options={sheetOptions(linen)} />,
    <Stack.Screen key="filters" name="discover/filters" options={sheetOptions(linen)} />,
    <Stack.Screen key="radius" name="discover/radius" options={sheetOptions(linen)} />,
    <Stack.Screen key="player" name="discover/player/[userId]" options={{ ...pushed, title: "" }} />,
    <Stack.Screen key="play" name="discover/play" options={{ ...pushed, title: "When I play" }} />,
    <Stack.Screen key="availability" name="availability" options={{ ...pushed, title: "" }} />,
    <Stack.Screen key="league" name="discover/league/[leagueId]" options={{ ...pushed, title: "" }} />,
    <Stack.Screen key="request" name="discover/request/[leagueId]" options={sheetOptions(linen)} />,
  ];
}
