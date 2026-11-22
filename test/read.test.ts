import { expect, test } from "bun:test";

// a DOM test, so it runs in a bun of its own (see a11y.test.ts)
test("opening threads marks them read at once, however fast (test/read.dom.tsx)", () => {
  const run = Bun.spawnSync(["bun", "test", "./test/read.dom.tsx"], { cwd: `${import.meta.dir}/..`, stderr: "pipe", stdout: "pipe" });
  const out = run.stderr.toString() + run.stdout.toString();
  if (run.exitCode !== 0) console.error(out);
  expect(run.exitCode).toBe(0);
  expect(out).toMatch(/\b3 pass\b/);
}, 60_000);
