import { expect, test } from "bun:test";

// a DOM test, so it runs in a bun of its own (see a11y.test.ts)
test("the Inbox's Unread view empties as you read, keeping the open thread until you move on (test/unread.dom.tsx)", () => {
  const run = Bun.spawnSync(["bun", "test", "./test/unread.dom.tsx"], { cwd: `${import.meta.dir}/..`, stderr: "pipe", stdout: "pipe" });
  const out = run.stderr.toString() + run.stdout.toString();
  if (run.exitCode !== 0) console.error(out);
  expect(run.exitCode).toBe(0);
  expect(out).toMatch(/\b7 pass\b/);
}, 60_000);
