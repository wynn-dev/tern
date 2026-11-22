/**
 * The inbox-zero art: a quiet landscape drawn from the day, so it's the same all day and new tomorrow.
 * Pure data (shapes and colour roles); components/inbox-zero.tsx draws it as SVG.
 */

/** Each role's colour in the light theme and the dark one. */
type Pair = [light: string, dark: string];
export type Palette = { name: string; sky0: Pair; sky1: Pair; sun: Pair; l1: Pair; l2: Pair; l3: Pair };
export type Role = "sun" | "l1" | "l2" | "l3";

const P = (l: number, c: number, h: number) => `oklch(${l} ${c} ${h})`;
export const PALETTES: Palette[] = [
  { name: "dawn", sky0: [P(0.985, 0.01, 60), P(0.2, 0.03, 300)], sky1: [P(0.94, 0.04, 50), P(0.27, 0.05, 330)], sun: [P(0.86, 0.09, 55), P(0.78, 0.1, 60)],
    l1: [P(0.88, 0.05, 20), P(0.32, 0.05, 320)], l2: [P(0.8, 0.07, 10), P(0.27, 0.05, 310)], l3: [P(0.7, 0.08, 355), P(0.22, 0.04, 300)] },
  { name: "sea", sky0: [P(0.985, 0.008, 220), P(0.19, 0.03, 250)], sky1: [P(0.93, 0.03, 210), P(0.25, 0.045, 240)], sun: [P(0.95, 0.05, 90), P(0.85, 0.06, 95)],
    l1: [P(0.86, 0.05, 205), P(0.32, 0.05, 230)], l2: [P(0.76, 0.07, 210), P(0.27, 0.05, 235)], l3: [P(0.62, 0.08, 220), P(0.22, 0.045, 245)] },
  { name: "sage", sky0: [P(0.985, 0.01, 120), P(0.19, 0.02, 160)], sky1: [P(0.94, 0.03, 110), P(0.24, 0.03, 150)], sun: [P(0.9, 0.08, 85), P(0.82, 0.08, 85)],
    l1: [P(0.86, 0.05, 140), P(0.31, 0.04, 155)], l2: [P(0.76, 0.06, 150), P(0.26, 0.04, 160)], l3: [P(0.64, 0.06, 160), P(0.21, 0.035, 165)] },
  { name: "dusk", sky0: [P(0.975, 0.015, 285), P(0.18, 0.04, 280)], sky1: [P(0.9, 0.05, 300), P(0.25, 0.07, 295)], sun: [P(0.88, 0.08, 40), P(0.8, 0.09, 45)],
    l1: [P(0.8, 0.06, 285), P(0.32, 0.07, 285)], l2: [P(0.7, 0.08, 280), P(0.27, 0.07, 280)], l3: [P(0.58, 0.1, 277), P(0.22, 0.06, 277)] },
  { name: "sand", sky0: [P(0.985, 0.012, 80), P(0.2, 0.02, 60)], sky1: [P(0.94, 0.035, 75), P(0.26, 0.03, 55)], sun: [P(0.84, 0.1, 60), P(0.78, 0.11, 55)],
    l1: [P(0.87, 0.05, 75), P(0.33, 0.04, 60)], l2: [P(0.79, 0.06, 65), P(0.28, 0.04, 55)], l3: [P(0.69, 0.07, 55), P(0.23, 0.035, 50)] },
];

export const W = 1200;
export const H = 800;

export type Shape = { d: string; fill: Role; opacity?: number };
export type Line = { d: string; stroke: Role; opacity: number; width: number };
export type Art = {
  day: string;
  palette: Palette;
  composition: string;
  sun: { cx: number; cy: number; r: number };
  /** Back to front. */
  shapes: Shape[];
  lines: Line[];
  /** The day's line under the title. */
  line: string;
};

const LINES = [
  "Nothing's waiting on you.",
  "All caught up.",
  "That's everything for now.",
  "Clear inbox, clear head.",
  "Quiet in here. Enjoy it.",
  "You're on top of it.",
  "Go do something else.",
];

/** FNV-1a, then mulberry32: a small, steady random stream from a string. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
type Rand = () => number;
const between = (rand: Rand, a: number, b: number) => a + (b - a) * rand();

/** A ridge across the whole width at height `y`: a few slow waves summed, filled down to the bottom. */
function ridge(rand: Rand, y: number, amp: number, freq: number) {
  const waves = Array.from({ length: 3 }, (_, i) => ({ a: amp / (i + 1), f: freq * (i + 1) * between(rand, 0.7, 1.3), p: rand() * Math.PI * 2 }));
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const x = (W * i) / 48;
    const dy = waves.reduce((s, w) => s + w.a * Math.sin((x / W) * Math.PI * 2 * w.f + w.p), 0);
    pts.push(`${r1(x)} ${r1(y + dy)}`);
  }
  return `M0 ${H}L${pts.join("L")}L${W} ${H}Z`;
}

const COMPOSITIONS: Record<string, (rand: Rand) => Pick<Art, "sun" | "shapes" | "lines">> = {
  /** Rolling hills under a low sun. */
  hills: (rand) => ({
    sun: { cx: between(rand, 0.28, 0.72) * W, cy: between(rand, 0.32, 0.44) * H, r: between(rand, 60, 100) },
    shapes: [
      { d: ridge(rand, H * 0.56, 34, 1.1), fill: "l1" },
      { d: ridge(rand, H * 0.67, 30, 0.9), fill: "l2" },
      { d: ridge(rand, H * 0.8, 24, 0.7), fill: "l3" },
    ],
    lines: [],
  }),
  /** Calm water: the sun on the horizon, swells, and its light across them. */
  tide: (rand) => {
    const cx = between(rand, 0.3, 0.7) * W, horizon = H * between(rand, 0.5, 0.56);
    return {
      sun: { cx, cy: horizon - between(rand, 10, 50), r: between(rand, 70, 110) },
      shapes: [
        { d: ridge(rand, horizon, 3, 2), fill: "l1" },
        { d: ridge(rand, H * 0.68, 10, 2.4), fill: "l2" },
        { d: ridge(rand, H * 0.84, 12, 2), fill: "l3" },
      ],
      lines: Array.from({ length: 6 }, (_, i) => {
        const y = horizon + 18 + i * 22, half = 120 - i * 14 + between(rand, -10, 10);
        return { d: `M${r1(cx - half)} ${r1(y)}H${r1(cx + half)}`, stroke: "sun" as const, opacity: 0.55 - i * 0.07, width: 3 };
      }),
    };
  },
  /** Big quiet circles setting into the ground, in the style of a print. */
  orbit: (rand) => {
    const left = rand() < 0.5;
    const cx = (left ? between(rand, 0.25, 0.45) : between(rand, 0.55, 0.75)) * W, ground = H * 0.8;
    const side = left ? 1 : -1;
    return {
      sun: { cx: (left ? between(rand, 0.6, 0.8) : between(rand, 0.2, 0.4)) * W, cy: between(rand, 0.25, 0.35) * H, r: between(rand, 40, 60) },
      shapes: [
        { d: circle(cx, ground, between(rand, 260, 320)), fill: "l1" },
        { d: circle(cx + side * between(rand, 160, 240), ground + 20, between(rand, 150, 200)), fill: "l2", opacity: 0.85 },
        { d: ridge(rand, ground, 4, 1.5), fill: "l3" },
      ],
      lines: [],
    };
  },
  /** Long dunes falling away to one side. */
  dunes: (rand) => {
    const dir = rand() < 0.5 ? 1 : -1;
    const dune = (y: number, tilt: number) => {
      const a = y - tilt * dir, b = y + tilt * dir, c = between(rand, -60, 40);
      return `M0 ${H}L0 ${r1(a)}Q${r1(W * between(rand, 0.35, 0.65))} ${r1((a + b) / 2 + c)} ${W} ${r1(b)}L${W} ${H}Z`;
    };
    return {
      sun: { cx: between(rand, 0.25, 0.75) * W, cy: between(rand, 0.28, 0.4) * H, r: between(rand, 50, 80) },
      shapes: [
        { d: dune(H * 0.58, 50), fill: "l1" },
        { d: dune(H * 0.7, 70), fill: "l2" },
        { d: dune(H * 0.83, 40), fill: "l3" },
      ],
      lines: [],
    };
  },
};

function circle(cx: number, cy: number, r: number) {
  return `M${r1(cx - r)} ${r1(cy)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(r * 2)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-r * 2)} 0Z`;
}

/** The art for a day (`2026-11-22`): the same all day, a different palette, composition and line tomorrow. */
export function zeroArt(day: string): Art {
  const rand = rng(day);
  const names = Object.keys(COMPOSITIONS);
  const palette = PALETTES[Math.floor(rand() * PALETTES.length)];
  const composition = names[Math.floor(rand() * names.length)];
  const line = LINES[Math.floor(rand() * LINES.length)];
  return { day, palette, composition, line, ...COMPOSITIONS[composition](rand) };
}
