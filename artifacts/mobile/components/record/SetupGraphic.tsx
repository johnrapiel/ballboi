// The ideal phone position (B7): a court from above, the phone on the fence
// behind one baseline, centered, sideways, back camera to the court, both
// baselines in its view. Drawn in ink with round caps, so it reads as the
// same hand as the brush headers in Day and Night. One accessible image with
// a text alternative; the checklist under it carries the details as text.

import React from "react";
import { View } from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";

import { radius } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { SETUP_GRAPHIC_LABEL } from "@/lib/recording/firstRun";

// Court in metres, scaled: 23.77 long, 10.97 wide (doubles), 8.23 (singles),
// service lines 6.40 from the net.
const S = 8.4;
const TOP = 36;
const LEN = 23.77 * S;
const CX = 110;
const halfD = (10.97 * S) / 2;
const halfS = (8.23 * S) / 2;
const NET = TOP + LEN / 2;
const SVC = 6.4 * S;
const BASE = TOP + LEN;
const FENCE = BASE + 34;

export function SetupGraphic() {
  const c = useColors();
  const line = { stroke: c.ink, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={SETUP_GRAPHIC_LABEL}
      style={{ alignItems: "center", backgroundColor: c.sand, borderRadius: radius.radiusCard, paddingVertical: 12 }}
    >
      <Svg width="100%" height={280} viewBox="0 0 220 300" preserveAspectRatio="xMidYMid meet">
        {/* What the phone sees: from the camera out to both far corners. */}
        <Path
          d={`M ${CX} ${FENCE - 6} L ${CX - halfD - 6} ${TOP - 6} L ${CX + halfD + 6} ${TOP - 6} Z`}
          fill={c.heat1}
          stroke={c.ink}
          strokeOpacity={0.55}
          strokeWidth={1.5}
          strokeDasharray="4 5"
          strokeLinecap="round"
        />
        {/* Court: doubles outline, singles lines, service boxes, net. */}
        <Rect x={CX - halfD} y={TOP} width={halfD * 2} height={LEN} fill="none" {...line} />
        <Line x1={CX - halfS} y1={TOP} x2={CX - halfS} y2={BASE} {...line} strokeWidth={1.5} />
        <Line x1={CX + halfS} y1={TOP} x2={CX + halfS} y2={BASE} {...line} strokeWidth={1.5} />
        <Line x1={CX - halfS} y1={NET - SVC} x2={CX + halfS} y2={NET - SVC} {...line} strokeWidth={1.5} />
        <Line x1={CX - halfS} y1={NET + SVC} x2={CX + halfS} y2={NET + SVC} {...line} strokeWidth={1.5} />
        <Line x1={CX} y1={NET - SVC} x2={CX} y2={NET + SVC} {...line} strokeWidth={1.5} />
        <Line x1={CX - halfD - 8} y1={NET} x2={CX + halfD + 8} y2={NET} {...line} strokeWidth={3} />
        {/* Fence behind the near baseline, drawn as posts and wire. */}
        <Line x1={18} y1={FENCE} x2={202} y2={FENCE} {...line} strokeWidth={1.5} />
        {[18, 64, 156, 202].map((x) => (
          <Line key={x} x1={x} y1={FENCE - 8} x2={x} y2={FENCE + 8} {...line} strokeWidth={1.5} />
        ))}
        {/* The phone: sideways on the fence, centered, filled so it stands out. */}
        <Rect x={CX - 15} y={FENCE - 9} width={30} height={16} rx={4} fill={c.ink} />
        <Rect x={CX - 3} y={FENCE - 7} width={6} height={3} rx={1.5} fill={c.sand} />
      </Svg>
    </View>
  );
}
