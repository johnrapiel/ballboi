// Profile > Edit profile > Name and photo (Wave 1 review A6): the onboarding screen in
// edit mode, under the standard back header.

import { Stack } from "expo-router";
import React from "react";

import { useEditHeader } from "@/components/profile/editHeader";
import NameStep from "@/app/onboarding/index";

export default function EditName() {
  const header = useEditHeader("Name and photo");
  return (
    <>
      <Stack.Screen options={header} />
      <NameStep mode="edit" />
    </>
  );
}
