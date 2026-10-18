import { motion, useReducedMotion } from "motion/react";
import { t as messages } from "../../lib/i18n";

/*
 * M3 Expressive loading indicator: a shape that continuously morphs and rotates
 * through the Material shape library (soft burst → cookie → pentagon → pill → sunny → oval).
 * Shapes are radial functions sampled at the same number of points so clip-path can morph.
 */

const POINTS = 72;

function shape(r: (t: number) => number, rotate = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < POINTS; i++) {
    const t = (i / POINTS) * Math.PI * 2 + rotate;
    const radius = 50 * r(t);
    pts.push(`${(50 + radius * Math.cos(t)).toFixed(2)}% ${(50 + radius * Math.sin(t)).toFixed(2)}%`);
  }
  return `polygon(${pts.join(", ")})`;
}

// Rounded polygons / scalloped shapes approximating the M3 shape library.
const lobes = (n: number, depth: number) => (t: number) => 1 - depth + depth * Math.cos((n * t) / 2) ** 2;
const ellipse = (a: number, b: number) => (t: number) => (a * b) / Math.hypot(b * Math.cos(t), a * Math.sin(t));
const SHAPES = [
  shape(lobes(10, 0.22)), // soft burst
  shape(lobes(9, 0.1)), // cookie 9
  shape((t) => 0.88 + 0.12 * Math.cos(5 * t)), // rounded pentagon
  shape(ellipse(1, 0.58), Math.PI / 4), // pill
  shape(lobes(8, 0.14)), // sunny
  shape(ellipse(1, 0.82)), // oval
];
const KEYFRAMES = [...SHAPES, SHAPES[0]!];
const TIMES = KEYFRAMES.map((_, i) => i / SHAPES.length);

export function LoadingIndicator({ size = 48, label = messages.common.loading }: { size?: number; label?: string }) {
  const reduced = useReducedMotion();
  return (
    <div
      role="progressbar"
      aria-label={label}
      className="flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <motion.div
        className="bg-primary"
        style={{ width: size * 0.79, height: size * 0.79 }}
        initial={{ clipPath: SHAPES[0] }}
        animate={reduced ? undefined : { clipPath: KEYFRAMES, rotate: [0, 360] }}
        transition={{
          clipPath: { duration: 4.2, ease: "easeInOut", repeat: Infinity, times: TIMES },
          rotate: { duration: 1.4, ease: "linear", repeat: Infinity },
        }}
      />
    </div>
  );
}
