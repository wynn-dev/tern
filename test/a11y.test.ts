import { expect, test } from "bun:test";

// the DOM tests need a fresh module cache (see a11y.dom.tsx), so they run in a bun of their own
test("controls have names and the page has its landmarks (test/a11y.dom.tsx)", () => {
  const run = Bun.spawnSync(["bun", "test", "./test/a11y.dom.tsx"], { cwd: `${import.meta.dir}/..`, stderr: "pipe", stdout: "pipe" });
  const out = run.stderr.toString() + run.stdout.toString();
  if (run.exitCode !== 0) console.error(out);
  expect(run.exitCode).toBe(0);
  expect(out).toMatch(/\b3 pass\b/);
}, 60_000);
