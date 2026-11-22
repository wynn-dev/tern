import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tern-config-"));
process.env.TERN_HOME = dir;
const { defaults, loadConfig, saveConfig } = await import("../src/server/config");

const file = join(dir, "config.json");
const write = (cfg: unknown) => writeFileSync(file, JSON.stringify(cfg));
// every config file Tern wrote before 0.2 had all the defaults of the day in it
const oldFile = { host: "127.0.0.1", port: 7420, ai: { enabled: true }, sync: { intervalSec: 30, initialDays: 60, maxInitial: 1500 } };

beforeEach(() => write({}));

test("Tern checks for new mail every 10 seconds by default", () => {
  expect(defaults.sync.intervalSec).toBe(10);
  expect(loadConfig().sync.intervalSec).toBe(10);
});

test("a config file saved with the old 30-second default gets the new one", () => {
  write(oldFile);
  expect(loadConfig().sync).toEqual({ intervalSec: 10, initialDays: 60, maxInitial: 1500 });
});

test("an interval someone chose stays, in an old file or a new one", () => {
  write({ ...oldFile, sync: { ...oldFile.sync, intervalSec: 60 } });
  expect(loadConfig().sync.intervalSec).toBe(60);

  // 30 set on purpose after the change is a choice too
  const cfg = loadConfig();
  cfg.sync.intervalSec = 30;
  saveConfig(cfg);
  expect(loadConfig().sync.intervalSec).toBe(30);
});

test("saving leaves default sync settings out of the file, so a later default still reaches it", () => {
  write(oldFile);
  saveConfig(loadConfig());
  const saved = JSON.parse(readFileSync(file, "utf8"));
  expect(saved.sync).toEqual({});
  expect(loadConfig().sync).toEqual(defaults.sync);
});
