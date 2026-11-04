// Profile > Edit profile > Self-rated level (Wave 1 review A6): the onboarding screen in
// edit mode, under the standard back header.

import { Stack } from "expo-router";
import React from "react";

import { useEditHeader } from "@/components/profile/editHeader";
import RatingStep from "@/app/onboarding/rating";

export default function EditRating() {
  const header = useEditHeader("Self-rated level");
  return (
    <>
      <Stack.Screen options={header} />
      <RatingStep mode="edit" />
    </>
  );
}
