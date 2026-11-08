// The court corners a phone sends when it starts a recording session (Wave 2,
// spec: Ball Boi > Processing, "court detection runs on device"). The phone
// either found the court itself or the player placed the corners on the
// court-line fix. Only a clean copy of a valid calibration is kept: any other
// key the request carries is dropped.

import { COURT_CALIBRATION_POINT_ORDER, asRecord, courtCalibrationFromMetadata } from "./ballBoiUtils";

const SOURCES = ["phone-detected", "phone-fixed"] as const;
type PhoneCourtSource = (typeof SOURCES)[number];

export interface PhoneCourtCalibration {
  version: 1;
  pointOrder: string[];
  points: { x: number; y: number }[];
  source: PhoneCourtSource;
  confidence?: number;
}

/** The calibration to store in session metadata, or null when the phone sent none or a bad one. */
export function phoneCourtCalibration(value: unknown): PhoneCourtCalibration | null {
  if (value == null) return null;
  const checked = courtCalibrationFromMetadata({ courtCalibration: value });
  if (!checked) return null;
  // Corners can sit a little off the frame (the near baseline is often cut
  // off), but not anywhere at all.
  if (checked.points.some((p) => p.x < -0.5 || p.x > 1.5 || p.y < -0.5 || p.y > 1.5)) return null;
  const sent = asRecord(value);
  const source = SOURCES.find((s) => s === sent.source) ?? "phone-fixed";
  const confidence = typeof sent.confidence === "number" && sent.confidence >= 0 && sent.confidence <= 1 ? sent.confidence : undefined;
  return {
    version: 1,
    pointOrder: [...COURT_CALIBRATION_POINT_ORDER],
    points: checked.points.map((p) => ({ x: p.x, y: p.y })),
    source,
    ...(source === "phone-detected" && confidence !== undefined ? { confidence } : {}),
  };
}
