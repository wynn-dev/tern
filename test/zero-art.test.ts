import { expect, test } from "bun:test";
import { zeroStats } from "../src/web/components/inbox-zero";
import { PALETTES, zeroArt } from "../src/web/lib/zero-art";

const days = Array.from({ length: 120 }, (_, i) => {
  const d = new Date(2026, 0, 1 + i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});

test("the art is the same all day and changes from day to day", () => {
  expect(zeroArt("2026-11-22")).toEqual(zeroArt("2026-11-22"));
  const looks = days.map((d) => { const a = zeroArt(d); return `${a.palette.name}/${a.composition}/${a.sun.cx}`; });
  // no two days in a row look alike, and over a few months every palette and composition comes round
  for (let i = 1; i < looks.length; i++) expect(looks[i]).not.toBe(looks[i - 1]);
  expect(new Set(days.map((d) => zeroArt(d).palette.name)).size).toBe(PALETTES.length);
  expect(new Set(days.map((d) => zeroArt(d).composition))).toEqual(new Set(["hills", "tide", "orbit", "dunes"]));
});

test("every palette has a light and a dark colour for every role, and the shapes are drawable", () => {
  for (const p of PALETTES) for (const r of ["sky0", "sky1", "sun", "l1", "l2", "l3"] as const) expect(p[r]).toHaveLength(2);
  for (const d of days) {
    const a = zeroArt(d);
    expect(a.shapes.length).toBeGreaterThan(0);
    for (const s of a.shapes) expect(s.d).toMatch(/^M[\d. -]+[LQa][^N]*Z$/);
    expect(a.line.length).toBeGreaterThan(0);
  }
});

test("the stats line says what's worth saying", () => {
  expect(zeroStats(undefined)).toEqual([]);
  expect(zeroStats({ cleared: 0, streak: 0 })).toEqual([]);
  expect(zeroStats({ cleared: 12, streak: 1 })).toEqual(["12 cleared today", "Streak started"]);
  expect(zeroStats({ cleared: 3, streak: 5 })).toEqual(["3 cleared today", "5-day streak"]);
});
