// The one profile photo picker (Wave 2 finding 52): Name and photo's Add or
// Change photo and Edit profile's Change photo open the same thing.

import * as ImagePicker from "expo-image-picker";

/** Opens the photo library with a square crop. Null when the person cancels. */
export async function pickProfilePhoto(): Promise<ImagePicker.ImagePickerAsset | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
    // iPhone camera photos are HEIC. Ask iOS for a JPEG copy, which every
    // part of the app and the API reads (finding #23).
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  return !result.canceled && result.assets[0] ? result.assets[0] : null;
}
