// The PWA sign-in hero's mark (pulse src/components/auth/AuthHero.tsx with Mark `animated`, globals.css beat-up /
// beat-down / beat-glow): the two beats move about once a second like a resting heart, the upper one lifts (lub), the
// lower one drops (dub) 160 ms later, and a teal-to-blue glow behind them breathes with the beat. With reduce motion
// everything holds still, as `motion-safe:` does on the web. The wordmark sits under the mark.
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "@/ui/theme";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** One beat, 1.2 s, the web's cubic-bezier(0.37, 0, 0.63, 1) on every step. */
const BEAT_MS = 1200;
const EASE = Easing.bezier(0.37, 0, 0.63, 1);
/** At 14 % of the beat the bars are 1.1 viewBox units out, back at 32 % (beat-up, beat-down). */
const OUT_MS = 0.14 * BEAT_MS;
const BACK_MS = (0.32 - 0.14) * BEAT_MS;
const REST_MS = BEAT_MS - OUT_MS - BACK_MS;
const MOVE = 1.1;
/** Room around the mark for the move. */
const PAD = 1.5;
/** The glow peaks at 18 % of the beat: opacity 0.32 → 0.55, scale 1 → 1.06 (beat-glow). */
const GLOW_PEAK_MS = 0.18 * BEAT_MS;

// The web's `size-40` hero box and `size-24` mark.
const BOX = 160;
const MARK = 96;

const beat = (to: number) =>
  withRepeat(withSequence(withTiming(to, { duration: OUT_MS, easing: EASE }), withTiming(0, { duration: BACK_MS, easing: EASE }), withTiming(0, { duration: REST_MS })), -1);

export function HeartbeatMark() {
  const { c } = useTheme();
  const reduce = useReducedMotion();
  const up = useSharedValue(0);
  const down = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    if (reduce) return;
    up.value = beat(-MOVE);
    down.value = withDelay(160, beat(MOVE));
    glow.value = withRepeat(withSequence(withTiming(1, { duration: GLOW_PEAK_MS, easing: EASE }), withTiming(0, { duration: BEAT_MS - GLOW_PEAK_MS, easing: EASE })), -1);
  }, [reduce, up, down, glow]);

  const upProps = useAnimatedProps(() => ({ y: 4.5 + up.value }));
  const downProps = useAnimatedProps(() => ({ y: 8.5 + down.value }));
  // Still, the glow sits at the web's opacity-35.
  const glowStyle = useAnimatedStyle(() => (reduce ? { opacity: 0.35 } : { opacity: 0.32 + 0.23 * glow.value, transform: [{ scale: 1 + 0.06 * glow.value }] }));

  return (
    <View accessibilityRole="image" accessibilityLabel="Health" className="items-center gap-7">
      <View style={{ width: BOX, height: BOX }} className="items-center justify-center">
        {/* radial-gradient(closest-side, optimal, strain-text at 60 % by 55 %, transparent), blurred: the fade to clear is the blur. */}
        <Animated.View style={[{ position: "absolute", width: BOX, height: BOX }, glowStyle]}>
          <Svg width={BOX} height={BOX}>
            <Defs>
              <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={c.optimal} stopOpacity={1} />
                <Stop offset="0.55" stopColor={c["strain-text"]} stopOpacity={0.6} />
                <Stop offset="1" stopColor={c["strain-text"]} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={BOX / 2} cy={BOX / 2} r={BOX / 2} fill="url(#glow)" />
          </Svg>
        </Animated.View>
        {/* The beats move past the mark's 15-unit box; Android clips an SVG at its bounds, so the box grows by the move. */}
        <Svg viewBox={`${4.5 - PAD} ${4.5 - PAD} ${15 + 2 * PAD} ${15 + 2 * PAD}`} width={(MARK * (15 + 2 * PAD)) / 15} height={(MARK * (15 + 2 * PAD)) / 15}>
          <AnimatedRect x={6.9} width={4.2} height={11} rx={2.1} fill={c.optimal} animatedProps={upProps} />
          <AnimatedRect x={12.9} width={4.2} height={11} rx={2.1} fill={c["strain-text"]} animatedProps={downProps} />
        </Svg>
      </View>
    </View>
  );
}
