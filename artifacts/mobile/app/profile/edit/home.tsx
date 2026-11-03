// Profile > Edit profile > Home area (Wave 1 review A6): the onboarding screen in
// edit mode, under the standard back header.

import { Stack } from "expo-router";
import React from "react";

import { useEditHeader } from "@/components/profile/editHeader";
import HomeAreaStep from "@/app/onboarding/home";

export default function EditHomeArea() {
  const header = useEditHeader("Home area");
  return (
    <>
      <Stack.Screen options={header} />
      <HomeAreaStep mode="edit" />
    </>
  );
}
