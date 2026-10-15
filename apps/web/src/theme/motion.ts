import type { Transition } from "motion/react";

/**
 * M3 Expressive motion scheme as spring transitions.
 * Values from the M3 motion tokens (ExpressiveMotionTokens): damping ratio ζ and stiffness k.
 * Motion expects a damping coefficient, so c = ζ · 2√(k·m) with mass m = 1.
 *
 * - spatial: position, size, shape (may overshoot/bounce)
 * - effects: color, opacity (no overshoot)
 */
function spring(dampingRatio: number, stiffness: number): Transition {
  return { type: "spring", stiffness, damping: dampingRatio * 2 * Math.sqrt(stiffness), mass: 1 };
}

export const motionScheme = {
  fastSpatial: spring(0.6, 800),
  defaultSpatial: spring(0.8, 380),
  slowSpatial: spring(0.8, 200),
  fastEffects: spring(1, 3800),
  defaultEffects: spring(1, 1600),
  slowEffects: spring(1, 800),
} as const;

/** Corner radius a pill-shaped control morphs to while pressed (Expressive shape morph). */
export const PRESSED_RADIUS = 12;
