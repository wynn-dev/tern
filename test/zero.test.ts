import { expect, test } from "bun:test";

// a DOM test, so it runs in a bun of its own (see a11y.test.ts)
test("the inbox-zero moment shows at zero unread, and triage counts down to it (test/zero.dom.tsx)", () => {
  const run = Bun.spawnSync(["bun", "test", "./test/zero.dom.tsx"], { cwd: `${import.meta.dir}/..`, stderr: "pipe", stdout: "pipe" });
  const out = run.stderr.toString() + run.stdout.toString();
  if (run.exitCode !== 0) console.error(out);
  expect(run.exitCode).toBe(0);
  expect(out).toMatch(/\b6 pass\b/);
}, 60_000);
