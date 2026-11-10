import { describe, expect, it } from "vitest";

import { focusSetting, focusShouldLock, RECORDING_LENS } from "@/lib/recording/settings";

describe("camera hold (no reframing while recording)", () => {
  it("pins the physical wide lens, not the self-switching multi-lens camera", () => {
    expect(RECORDING_LENS).toBe("AVCaptureDeviceTypeBuiltInWideAngleCamera");
  });

  it("keeps focusing while aiming, locks at court lock or a Record anyway start", () => {
    expect(focusShouldLock({ courtLocked: false, countingAnyway: false, capturing: false })).toBe(false);
    expect(focusShouldLock({ courtLocked: true, countingAnyway: false, capturing: false })).toBe(true);
    expect(focusShouldLock({ courtLocked: false, countingAnyway: true, capturing: false })).toBe(true);
  });

  it("never unlocks once capture starts, even after a bump", () => {
    expect(focusShouldLock({ courtLocked: false, countingAnyway: false, capturing: true })).toBe(true);
  });

  it("maps to expo-camera's autofocus prop", () => {
    expect(focusSetting(true)).toBe("on");
    expect(focusSetting(false)).toBe("off");
  });
});
