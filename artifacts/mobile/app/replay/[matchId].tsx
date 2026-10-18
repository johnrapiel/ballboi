import { Ionicons } from "@expo/vector-icons";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Line, Rect, Text as SvgText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetBallBoiReplay } from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

type Tab = "video" | "heatmap" | "shots" | "stats";

const COURT_W = Dimensions.get("window").width - 40;
const COURT_H = COURT_W * 0.55;

function TennisCourt({
  shots,
  colors,
  activeIndex,
}: {
  shots: any[];
  colors: any;
  activeIndex?: number;
}) {
  const w = COURT_W;
  const h = COURT_H;
  const px = 20;
  const py = 14;

  const getColor = (outcome: string | null | undefined) => {
    if (outcome === "winner") return colors.primary;
    if (outcome === "error" || outcome === "unforced_error")
      return colors.destructive;
    return "#aaaaaa";
  };

  return (
    <Svg width={w} height={h} style={{ borderRadius: colors.radius }}>
      <Rect x={0} y={0} width={w} height={h} fill={colors.card} rx={colors.radius} />
      <Rect
        x={px} y={py}
        width={w - px * 2} height={h - py * 2}
        fill="#1a4d20"
        rx={4}
      />
      <Rect
        x={px} y={py}
        width={w - px * 2} height={h - py * 2}
        fill="none"
        stroke="white"
        strokeWidth={1.5}
        rx={4}
      />
      <Line
        x1={w / 2} y1={py}
        x2={w / 2} y2={h - py}
        stroke="white" strokeWidth={1.5}
      />
      <Line
        x1={px} y1={h / 2}
        x2={w - px} y2={h / 2}
        stroke="white" strokeWidth={1}
      />
      <Line
        x1={px + (w - px * 2) * 0.18} y1={py}
        x2={px + (w - px * 2) * 0.18} y2={h - py}
        stroke="white" strokeWidth={1}
      />
      <Line
        x1={w - px - (w - px * 2) * 0.18} y1={py}
        x2={w - px - (w - px * 2) * 0.18} y2={h - py}
        stroke="white" strokeWidth={1}
      />
      <Line
        x1={px} y1={h / 2}
        x2={w - px} y2={h / 2}
        stroke="#dddddd" strokeWidth={3}
      />
      {shots.map((shot, i) => {
        const cx =
          shot.contactX != null ? px + shot.contactX * (w - px * 2) : null;
        const cy =
          shot.contactY != null ? py + shot.contactY * (h - py * 2) : null;
        if (cx == null || cy == null) return null;
        const isActive = i === activeIndex;
        return (
          <Circle
            key={i}
            cx={cx}
            cy={cy}
            r={isActive ? 8 : 5}
            fill={getColor(shot.outcome)}
            opacity={isActive ? 1 : activeIndex != null ? 0.3 : 0.75}
            stroke={isActive ? "white" : "none"}
            strokeWidth={isActive ? 2 : 0}
          />
        );
      })}
    </Svg>
  );
}

const MINI_COURT_W = 80;
const MINI_COURT_H = 44;

function MiniCourt({
  shot,
  colors,
}: {
  shot: any;
  colors: any;
}) {
  const w = MINI_COURT_W;
  const h = MINI_COURT_H;
  const px = 6;
  const py = 4;

  const hasPos = shot?.contactX != null && shot?.contactY != null;
  const cx = hasPos ? px + shot.contactX * (w - px * 2) : null;
  const cy = hasPos ? py + shot.contactY * (h - py * 2) : null;

  const dotColor =
    shot?.outcome === "winner"
      ? colors.primary
      : shot?.outcome === "error" || shot?.outcome === "unforced_error"
      ? colors.destructive
      : "#aaaaaa";

  return (
    <Svg width={w} height={h}>
      <Rect x={0} y={0} width={w} height={h} fill="rgba(0,0,0,0.55)" rx={6} />
      <Rect
        x={px} y={py}
        width={w - px * 2} height={h - py * 2}
        fill="#1a4d20"
        rx={2}
      />
      <Rect
        x={px} y={py}
        width={w - px * 2} height={h - py * 2}
        fill="none"
        stroke="white"
        strokeWidth={0.8}
        rx={2}
      />
      <Line
        x1={w / 2} y1={py}
        x2={w / 2} y2={h - py}
        stroke="white" strokeWidth={0.8}
      />
      <Line
        x1={px} y1={h / 2}
        x2={w - px} y2={h / 2}
        stroke="white" strokeWidth={0.6}
      />
      <Line
        x1={px + (w - px * 2) * 0.18} y1={py}
        x2={px + (w - px * 2) * 0.18} y2={h - py}
        stroke="white" strokeWidth={0.5}
      />
      <Line
        x1={w - px - (w - px * 2) * 0.18} y1={py}
        x2={w - px - (w - px * 2) * 0.18} y2={h - py}
        stroke="white" strokeWidth={0.5}
      />
      {cx != null && cy != null && (
        <Circle
          cx={cx}
          cy={cy}
          r={4}
          fill={dotColor}
          stroke="white"
          strokeWidth={1}
        />
      )}
    </Svg>
  );
}

function VideoTab({
  videoUrl,
  shots,
  colors,
}: {
  videoUrl: string | null;
  shots: any[];
  colors: any;
}) {
  const player = useVideoPlayer(videoUrl ?? null, (p) => {
    p.loop = false;
  });

  const { currentTime } = useEvent(player, "timeUpdate", {
    currentTime: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });

  const activeShotIndex = React.useMemo(() => {
    if (!shots.length || currentTime <= 0) return -1;
    let bestIdx = -1;
    let bestDist = Infinity;
    shots.forEach((shot, idx) => {
      if (shot.timestampSeconds == null) return;
      const dist = Math.abs(shot.timestampSeconds - currentTime);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });
    return bestDist <= 2 ? bestIdx : -1;
  }, [shots, currentTime]);

  const activeShot = activeShotIndex >= 0 ? shots[activeShotIndex] : null;

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const displayedShotRef = useRef<typeof activeShot>(null);
  const fadeOutAnim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (activeShot) {
      displayedShotRef.current = activeShot;
      if (fadeOutAnim.current) {
        fadeOutAnim.current.stop();
        fadeOutAnim.current = null;
      }
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    } else {
      const anim = Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      });
      fadeOutAnim.current = anim;
      anim.start(({ finished }) => {
        if (finished) {
          displayedShotRef.current = null;
          fadeOutAnim.current = null;
        }
      });
    }
  }, [activeShot, overlayOpacity]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    videoWrapper: {
      width: "100%",
      aspectRatio: 16 / 9,
      backgroundColor: "#000",
      position: "relative",
    },
    shotOverlay: {
      position: "absolute",
      bottom: 12,
      left: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: "rgba(0, 0, 0, 0.65)",
      borderRadius: 20,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.15)",
    },
    shotOverlayType: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: "#ffffff",
      textTransform: "capitalize",
      fontFamily: "DMSans_600SemiBold",
    },
    shotOverlayBadge: {
      borderRadius: 10,
      paddingVertical: 2,
      paddingHorizontal: 7,
    },
    shotOverlayBadgeText: {
      fontSize: 11,
      fontWeight: "600" as const,
      textTransform: "capitalize",
      fontFamily: "DMSans_600SemiBold",
    },
    shotOverlaySpeed: {
      fontSize: 13,
      fontWeight: "700" as const,
      color: "#ffffff",
      fontFamily: "DMSans_700Bold",
    },
    shotOverlaySpeedUnit: {
      fontSize: 10,
      color: "rgba(255,255,255,0.7)",
      fontFamily: "DMSans_400Regular",
    },
    noVideo: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 60,
    },
    noVideoText: {
      fontSize: 14,
      color: colors.mutedForeground,
      marginTop: 12,
      textAlign: "center",
      fontFamily: "DMSans_400Regular",
    },
    heatmapSection: {
      padding: 20,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: colors.mutedForeground,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      marginBottom: 12,
      fontFamily: "DMSans_600SemiBold",
    },
    activeShotCard: {
      marginTop: 16,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius + 2,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    activeShotNum: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary + "22",
      borderWidth: 1,
      borderColor: colors.primary + "55",
      alignItems: "center",
      justifyContent: "center",
    },
    activeShotNumText: {
      fontSize: 13,
      fontWeight: "700" as const,
      color: colors.primary,
      fontFamily: "DMSans_700Bold",
    },
    activeShotInfo: {
      flex: 1,
    },
    activeShotType: {
      fontSize: 14,
      fontWeight: "600" as const,
      color: colors.foreground,
      textTransform: "capitalize",
      fontFamily: "DMSans_600SemiBold",
    },
    activeShotMeta: {
      fontSize: 12,
      color: colors.mutedForeground,
      marginTop: 2,
      fontFamily: "DMSans_400Regular",
    },
    activeShotOutcome: {
      fontSize: 12,
      fontWeight: "600" as const,
      textTransform: "capitalize",
      fontFamily: "DMSans_600SemiBold",
    },
    miniCourtStrip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    miniCourtLabel: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontFamily: "DMSans_400Regular",
      flex: 1,
    },
    miniCourtZone: {
      fontSize: 11,
      fontWeight: "600" as const,
      color: colors.foreground,
      fontFamily: "DMSans_600SemiBold",
    },
    noShotCard: {
      marginTop: 16,
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 12,
      alignItems: "center",
    },
    noShotText: {
      fontSize: 12,
      color: colors.mutedForeground,
      fontFamily: "DMSans_400Regular",
    },
    legend: {
      flexDirection: "row",
      gap: 20,
      marginTop: 16,
      justifyContent: "center",
    },
    legendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    legendDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    legendText: {
      fontSize: 12,
      color: colors.mutedForeground,
      fontFamily: "DMSans_400Regular",
    },
  });

  if (!videoUrl) {
    return (
      <View style={styles.noVideo}>
        <Ionicons name="videocam-off-outline" size={40} color={colors.mutedForeground} />
        <Text style={styles.noVideoText}>
          No video available for this match.{"\n"}Record a session with Ball Boi to watch footage here.
        </Text>
      </View>
    );
  }

  const getOutcomeColor = (outcome: string | null | undefined) => {
    if (outcome === "winner") return colors.primary;
    if (outcome === "error" || outcome === "unforced_error")
      return colors.destructive;
    return colors.mutedForeground;
  };

  const shotsWithPosition = shots.filter(
    (s) => s.contactX != null && s.contactY != null
  );

  return (
    <View style={styles.container}>
      <View style={styles.videoWrapper}>
        <VideoView
          player={player}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
          nativeControls
        />
        {(() => {
          const shot = activeShot ?? displayedShotRef.current;
          if (!shot) return null;
          const outcome = shot.outcome ?? null;
          const isWinner = outcome === "winner";
          const isError = outcome === "error" || outcome === "unforced_error";
          const badgeBg = isWinner
            ? colors.primary + "33"
            : isError
            ? colors.destructive + "33"
            : "rgba(255,255,255,0.15)";
          const badgeColor = isWinner
            ? colors.primary
            : isError
            ? colors.destructive
            : "rgba(255,255,255,0.8)";
          const outcomeLabel = isWinner
            ? "winner"
            : isError
            ? "error"
            : "rally";
          return (
            <Animated.View style={[styles.shotOverlay, { opacity: overlayOpacity }]}>
              <Text style={styles.shotOverlayType}>
                {shot.shotType?.replace(/_/g, " ") ?? "shot"}
              </Text>
              <View style={[styles.shotOverlayBadge, { backgroundColor: badgeBg }]}>
                <Text style={[styles.shotOverlayBadgeText, { color: badgeColor }]}>
                  {outcomeLabel}
                </Text>
              </View>
              {shot.speedMph != null && (
                <Text style={styles.shotOverlaySpeed}>
                  {Math.round(shot.speedMph)}{" "}
                  <Text style={styles.shotOverlaySpeedUnit}>mph</Text>
                </Text>
              )}
            </Animated.View>
          );
        })()}
      </View>

      {(() => {
        const shot = activeShot ?? displayedShotRef.current;
        const hasPos = shot?.contactX != null && shot?.contactY != null;
        if (!shot || !hasPos) return null;
        return (
          <Animated.View style={[styles.miniCourtStrip, { opacity: overlayOpacity }]}>
            <MiniCourt shot={shot} colors={colors} />
            <View style={{ flex: 1 }}>
              <Text style={styles.miniCourtLabel}>Court position</Text>
              {shot.courtZoneName ? (
                <Text style={styles.miniCourtZone}>{shot.courtZoneName}</Text>
              ) : null}
            </View>
          </Animated.View>
        );
      })()}

      <View style={styles.heatmapSection}>
        <Text style={styles.sectionLabel}>Shot Heatmap</Text>
        {shotsWithPosition.length > 0 ? (
          <>
            <TennisCourt
              shots={shots}
              colors={colors}
              activeIndex={activeShotIndex >= 0 ? activeShotIndex : undefined}
            />
            <View style={styles.legend}>
              {[
                { color: colors.primary, label: "Winner" },
                { color: colors.destructive, label: "Error" },
                { color: "#aaaaaa", label: "Rally" },
              ].map((item) => (
                <View key={item.label} style={styles.legendItem}>
                  <View
                    style={[styles.legendDot, { backgroundColor: item.color }]}
                  />
                  <Text style={styles.legendText}>{item.label}</Text>
                </View>
              ))}
            </View>

            {activeShot ? (
              <View style={styles.activeShotCard}>
                <View style={styles.activeShotNum}>
                  <Text style={styles.activeShotNumText}>
                    {activeShotIndex + 1}
                  </Text>
                </View>
                <View style={styles.activeShotInfo}>
                  <Text style={styles.activeShotType}>
                    {activeShot.shotType?.replace(/_/g, " ") ?? "Unknown"}
                  </Text>
                  <Text style={styles.activeShotMeta}>
                    Rally {activeShot.rallyNumber ?? "-"}
                    {activeShot.courtZoneName
                      ? ` · ${activeShot.courtZoneName}`
                      : ""}
                    {activeShot.timestampSeconds != null
                      ? ` · ${activeShot.timestampSeconds.toFixed(1)}s`
                      : ""}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.activeShotOutcome,
                    { color: getOutcomeColor(activeShot.outcome) },
                  ]}
                >
                  {activeShot.outcome?.replace(/_/g, " ") ?? ""}
                </Text>
              </View>
            ) : (
              <View style={styles.noShotCard}>
                <Text style={styles.noShotText}>
                  Play the video — shots will highlight as you watch
                </Text>
              </View>
            )}
          </>
        ) : (
          <View style={{ alignItems: "center", paddingVertical: 24 }}>
            <Text style={styles.noShotText}>
              No shot position data available
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function HeatmapTab({ data, colors }: { data: any; colors: any }) {
  const shots = data?.shots ?? [];
  const styles = StyleSheet.create({
    container: {
      padding: 20,
    },
    legend: {
      flexDirection: "row",
      gap: 20,
      marginTop: 16,
      justifyContent: "center",
    },
    legendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    legendDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    legendText: {
      fontSize: 12,
      color: colors.mutedForeground,
      fontFamily: "DMSans_400Regular",
    },
    empty: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 60,
    },
    emptyText: {
      fontSize: 14,
      color: colors.mutedForeground,
      marginTop: 12,
      fontFamily: "DMSans_400Regular",
    },
  });

  if (!shots.length) {
    return (
      <View style={styles.empty}>
        <Ionicons name="map-outline" size={40} color={colors.mutedForeground} />
        <Text style={styles.emptyText}>No shot data available</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TennisCourt shots={shots} colors={colors} />
      <View style={styles.legend}>
        {[
          { color: colors.primary, label: "Winner" },
          { color: colors.destructive, label: "Error" },
          { color: "#aaaaaa", label: "Rally" },
        ].map((item) => (
          <View key={item.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={styles.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ShotItem({
  shot,
  index,
  colors,
}: {
  shot: any;
  index: number;
  colors: any;
}) {
  const getOutcomeColor = (outcome: string | null | undefined) => {
    if (outcome === "winner") return colors.primary;
    if (outcome === "error" || outcome === "unforced_error")
      return colors.destructive;
    return colors.mutedForeground;
  };

  const styles = StyleSheet.create({
    item: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 14,
    },
    number: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    numberText: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: colors.mutedForeground,
      fontFamily: "DMSans_600SemiBold",
    },
    info: {
      flex: 1,
    },
    shotType: {
      fontSize: 14,
      fontWeight: "600" as const,
      color: colors.foreground,
      textTransform: "capitalize",
      fontFamily: "DMSans_600SemiBold",
    },
    meta: {
      fontSize: 12,
      color: colors.mutedForeground,
      marginTop: 2,
      fontFamily: "DMSans_400Regular",
    },
    outcome: {
      fontSize: 12,
      fontWeight: "600" as const,
      textTransform: "capitalize",
      fontFamily: "DMSans_600SemiBold",
    },
    speed: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: colors.foreground,
      fontFamily: "DMSans_600SemiBold",
    },
    speedUnit: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontFamily: "DMSans_400Regular",
    },
  });

  return (
    <View style={styles.item}>
      <View style={styles.number}>
        <Text style={styles.numberText}>{index + 1}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.shotType}>
          {shot.shotType?.replace(/_/g, " ") ?? "Unknown"}
        </Text>
        <Text style={styles.meta}>
          Rally {shot.rallyNumber ?? "-"}
          {shot.courtZoneName ? ` · ${shot.courtZoneName}` : ""}
        </Text>
      </View>
      <Text style={[styles.outcome, { color: getOutcomeColor(shot.outcome) }]}>
        {shot.outcome?.replace(/_/g, " ") ?? ""}
      </Text>
      {shot.speedMph != null && (
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.speed}>{Math.round(shot.speedMph)}</Text>
          <Text style={styles.speedUnit}>mph</Text>
        </View>
      )}
    </View>
  );
}

function ShotsTab({ data, colors }: { data: any; colors: any }) {
  const shots = data?.shots ?? [];

  if (!shots.length) {
    return (
      <View
        style={{
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 60,
        }}
      >
        <Ionicons
          name="list-outline"
          size={40}
          color={colors.mutedForeground}
        />
        <Text
          style={{
            fontSize: 14,
            color: colors.mutedForeground,
            marginTop: 12,
            fontFamily: "DMSans_400Regular",
          }}
        >
          No shots recorded
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={shots}
      keyExtractor={(s, i) => String(s.id ?? i)}
      renderItem={({ item, index }) => (
        <ShotItem shot={item} index={index} colors={colors} />
      )}
      scrollEnabled={false}
    />
  );
}

function StatRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: any;
}) {
  const styles = StyleSheet.create({
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    label: {
      fontSize: 14,
      color: colors.mutedForeground,
      fontFamily: "DMSans_400Regular",
    },
    value: {
      fontSize: 15,
      fontWeight: "600" as const,
      color: colors.foreground,
      fontFamily: "DMSans_600SemiBold",
    },
  });
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function StatsTab({ data, colors }: { data: any; colors: any }) {
  const stats = data?.statistics;

  const styles = StyleSheet.create({
    container: {
      paddingHorizontal: 20,
    },
    section: {
      marginBottom: 28,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: colors.mutedForeground,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      marginBottom: 4,
      marginTop: 20,
      fontFamily: "DMSans_600SemiBold",
    },
    card: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius + 2,
      padding: 16,
    },
    bigStatRow: {
      flexDirection: "row",
      gap: 12,
      marginBottom: 16,
    },
    bigStat: {
      flex: 1,
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 14,
      alignItems: "center",
    },
    bigStatValue: {
      fontSize: 28,
      fontWeight: "700" as const,
      color: colors.foreground,
      fontFamily: "DMSans_700Bold",
    },
    bigStatLabel: {
      fontSize: 11,
      color: colors.mutedForeground,
      marginTop: 4,
      textAlign: "center",
      fontFamily: "DMSans_400Regular",
    },
    breakdownRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    breakdownLabel: {
      fontSize: 13,
      color: colors.foreground,
      textTransform: "capitalize",
      fontFamily: "DMSans_400Regular",
    },
    breakdownCount: {
      fontSize: 14,
      fontWeight: "600" as const,
      color: colors.foreground,
      fontFamily: "DMSans_600SemiBold",
    },
    empty: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 60,
    },
    emptyText: {
      fontSize: 14,
      color: colors.mutedForeground,
      marginTop: 12,
      fontFamily: "DMSans_400Regular",
    },
  });

  if (!stats) {
    return (
      <View style={styles.empty}>
        <Ionicons
          name="bar-chart-outline"
          size={40}
          color={colors.mutedForeground}
        />
        <Text style={styles.emptyText}>No statistics available</Text>
      </View>
    );
  }

  const shotBreakdown: Record<string, number> = stats.shotTypeBreakdown ?? {};
  const outcomeBreakdown: Record<string, number> = stats.outcomeBreakdown ?? {};

  return (
    <View style={styles.container}>
      <View style={styles.bigStatRow}>
        {[
          { value: String(stats.totalShots ?? "-"), label: "Shots" },
          { value: String(stats.totalRallies ?? "-"), label: "Rallies" },
          {
            value:
              stats.avgRallyLength != null
                ? String(Math.round(stats.avgRallyLength))
                : "-",
            label: "Avg Rally",
          },
        ].map((s) => (
          <View key={s.label} style={styles.bigStat}>
            <Text style={styles.bigStatValue}>{s.value}</Text>
            <Text style={styles.bigStatLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Shot Speed</Text>
      <View style={styles.card}>
        <StatRow
          label="Average speed"
          value={
            stats.avgShotSpeedMph != null
              ? `${Math.round(stats.avgShotSpeedMph)} mph`
              : "-"
          }
          colors={colors}
        />
        <StatRow
          label="Fastest shot"
          value={
            stats.fastestShotMph != null
              ? `${Math.round(stats.fastestShotMph)} mph`
              : "-"
          }
          colors={colors}
        />
        <StatRow
          label="Winners"
          value={String(stats.winners ?? "-")}
          colors={colors}
        />
        <StatRow
          label="Errors"
          value={String(stats.errors ?? "-")}
          colors={colors}
        />
      </View>

      {Object.keys(shotBreakdown).length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Shot Types</Text>
          <View style={styles.card}>
            {Object.entries(shotBreakdown).map(([type, count], i) => (
              <View
                key={type}
                style={[
                  styles.breakdownRow,
                  i === Object.keys(shotBreakdown).length - 1 && {
                    borderBottomWidth: 0,
                  },
                ]}
              >
                <Text style={styles.breakdownLabel}>
                  {type.replace(/_/g, " ")}
                </Text>
                <Text style={styles.breakdownCount}>{count}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {Object.keys(outcomeBreakdown).length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Outcomes</Text>
          <View style={[styles.card, { marginBottom: 24 }]}>
            {Object.entries(outcomeBreakdown).map(([outcome, count], i) => (
              <View
                key={outcome}
                style={[
                  styles.breakdownRow,
                  i === Object.keys(outcomeBreakdown).length - 1 && {
                    borderBottomWidth: 0,
                  },
                ]}
              >
                <Text style={styles.breakdownLabel}>
                  {outcome.replace(/_/g, " ")}
                </Text>
                <Text style={styles.breakdownCount}>{count}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

export default function ReplayScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("video");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { data, isLoading, isError, refetch } = useGetBallBoiReplay(
    Number(matchId)
  );

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingTop: topPad + 8,
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    headerInfo: {
      flex: 1,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: "700" as const,
      color: colors.foreground,
      fontFamily: "DMSans_700Bold",
    },
    headerSub: {
      fontSize: 12,
      color: colors.mutedForeground,
      fontFamily: "DMSans_400Regular",
      marginTop: 2,
    },
    ballBoiChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: colors.primary + "22",
      borderWidth: 1,
      borderColor: colors.primary + "55",
      borderRadius: 100,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    ballBoiText: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: colors.primary,
      fontFamily: "DMSans_600SemiBold",
    },
    tabs: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    tab: {
      flex: 1,
      paddingVertical: 12,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 6,
    },
    tabActive: {
      borderBottomWidth: 2,
      borderBottomColor: colors.primary,
    },
    tabText: {
      fontSize: 13,
      fontWeight: "500" as const,
      color: colors.mutedForeground,
      fontFamily: "DMSans_500Medium",
    },
    tabTextActive: {
      color: colors.primary,
      fontWeight: "600" as const,
      fontFamily: "DMSans_600SemiBold",
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 40,
    },
    errorTitle: {
      fontSize: 18,
      fontWeight: "600" as const,
      color: colors.foreground,
      marginTop: 16,
      fontFamily: "DMSans_600SemiBold",
    },
    errorSub: {
      fontSize: 14,
      color: colors.mutedForeground,
      marginTop: 8,
      textAlign: "center",
      fontFamily: "DMSans_400Regular",
    },
    retryBtn: {
      marginTop: 20,
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingHorizontal: 24,
      paddingVertical: 12,
    },
    retryText: {
      fontSize: 14,
      fontWeight: "600" as const,
      color: colors.primaryForeground,
      fontFamily: "DMSans_600SemiBold",
    },
  });

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "video", label: "Video", icon: "play-circle" },
    { key: "heatmap", label: "Heatmap", icon: "map" },
    { key: "shots", label: "Shots", icon: "list" },
    { key: "stats", label: "Stats", icon: "bar-chart" },
  ];

  const match = data?.match;
  const p1 = match?.player1Name ?? `P${match?.player1Id}`;
  const p2 = match?.player2Name ?? `P${match?.player2Id}`;
  const score = match?.score;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={20} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerInfo}>
          {match ? (
            <>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {p1} vs {p2}
              </Text>
              {score && <Text style={styles.headerSub}>{score}</Text>}
            </>
          ) : (
            <Text style={styles.headerTitle}>Ball Boi Replay</Text>
          )}
        </View>
        <View style={styles.ballBoiChip}>
          <Ionicons name="videocam" size={12} color={colors.primary} />
          <Text style={styles.ballBoiText}>Ball Boi</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.mutedForeground}
          />
          <Text style={styles.errorTitle}>Replay unavailable</Text>
          <Text style={styles.errorSub}>
            Something went wrong loading the replay. Please try again.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.retryBtn,
              { opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={() => refetch()}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : data?.session == null ? (
        <View style={styles.centered}>
          <Ionicons
            name="videocam-outline"
            size={48}
            color={colors.mutedForeground}
          />
          <Text style={styles.errorTitle}>No replay yet</Text>
          <Text style={styles.errorSub}>
            Ball Boi data has not been recorded for this match.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.backBtn,
              {
                opacity: pressed ? 0.8 : 1,
                marginTop: 20,
                width: "auto" as any,
                paddingHorizontal: 24,
                height: 44,
              },
            ]}
            onPress={() => router.back()}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600" as const,
                color: colors.foreground,
                fontFamily: "DMSans_600SemiBold",
              }}
            >
              Go back
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.tabs}>
            {TABS.map((t) => {
              const isActive = activeTab === t.key;
              return (
                <Pressable
                  key={t.key}
                  style={[styles.tab, isActive && styles.tabActive]}
                  onPress={() => setActiveTab(t.key)}
                >
                  <Ionicons
                    name={t.icon as any}
                    size={16}
                    color={isActive ? colors.primary : colors.mutedForeground}
                  />
                  <Text
                    style={[styles.tabText, isActive && styles.tabTextActive]}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {activeTab === "video" ? (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: bottomPad + 20 }}
              showsVerticalScrollIndicator={false}
            >
              <VideoTab
                videoUrl={data?.videoUrl ?? null}
                shots={data?.shots ?? []}
                colors={colors}
              />
            </ScrollView>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: bottomPad + 20 }}
              showsVerticalScrollIndicator={false}
            >
              {activeTab === "heatmap" && (
                <HeatmapTab data={data} colors={colors} />
              )}
              {activeTab === "shots" && (
                <ShotsTab data={data} colors={colors} />
              )}
              {activeTab === "stats" && (
                <StatsTab data={data} colors={colors} />
              )}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}
