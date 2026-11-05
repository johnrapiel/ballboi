import { describe, expect, it } from "vitest";

import { courtCalibrationFromMetadata } from "../lib/ballBoiUtils";
import { phoneCourtCalibration } from "../lib/phoneCourtCalibration";

const pointOrder = ["Near left baseline", "Near right baseline", "Far right baseline", "Far left baseline"];
const points = [
  { x: 0.1, y: 0.93 },
  { x: 0.9, y: 0.93 },
  { x: 0.63, y: 0.3 },
  { x: 0.37, y: 0.3 },
];

describe("phoneCourtCalibration", () => {
  it("keeps a phone-detected calibration with its confidence", () => {
    const cal = phoneCourtCalibration({ version: 1, pointOrder, points, source: "phone-detected", confidence: 0.72 });
    expect(cal).toEqual({ version: 1, pointOrder, points, source: "phone-detected", confidence: 0.72 });
    // What the analysis dispatch reads back.
    expect(courtCalibrationFromMetadata({ courtCalibration: cal })?.points).toEqual(points);
  });

  it("allows a near corner just below the frame", () => {
    const low = [{ x: 0.02, y: 1.08 }, { x: 0.98, y: 1.08 }, points[2], points[3]];
    expect(phoneCourtCalibration({ pointOrder, points: low, source: "phone-fixed" })?.points).toEqual(low);
  });

  it("drops a missing, misordered, crossed or far-off calibration", () => {
    expect(phoneCourtCalibration(undefined)).toBeNull();
    expect(phoneCourtCalibration({ pointOrder: [...pointOrder].reverse(), points })).toBeNull();
    expect(phoneCourtCalibration({ pointOrder, points: [points[0], points[1], points[3], points[2]] })).toBeNull();
    expect(phoneCourtCalibration({ pointOrder, points: points.map((p) => ({ x: p.x * 10, y: p.y * 10 })) })).toBeNull();
  });

  it("never keeps keys the phone has no business setting", () => {
    const cal = phoneCourtCalibration({ pointOrder, points, source: "server", confidence: 7, mlCallbackToken: "x" });
    expect(cal).toEqual({ version: 1, pointOrder, points, source: "phone-fixed" });
  });
});
