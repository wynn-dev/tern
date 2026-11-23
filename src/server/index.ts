import { join } from "node:path";
import { classifyPending } from "./ai";
import { createApp } from "./app";
import { ensureDataDir, loadConfig, setServeAddress } from "./config";
import { openDb } from "./db";
import { seedDemo } from "./demo";
import { startSyncLoop } from "./sync";
import { dropBackup, startUpdateChecks } from "./update";
import { installedBin } from "../cli/service";

export async function serve(opts: { demo?: boolean; port?: number; host?: string }) {
  const cfg = loadConfig();
  const demo = !!opts.demo;
  openDb(demo ? join(ensureDataDir(), "demo.db") : undefined);
  if (demo) seedDemo();

  let assets: Record<string, string> | undefined;
  try {
    // @ts-ignore generated at build time
    assets = (await import("./assets.gen")).assets;
  } catch {
    // dev: served from dist/web on disk
  }

  const app = createApp({ demo, assets });
  const port = opts.port ?? cfg.port;
  const hostname = opts.host ?? cfg.host;
  const server = Bun.serve({ port, hostname, fetch: app.fetch, idleTimeout: 0 });
  setServeAddress({ hostname, port: server.port ?? port });
  console.log(`tern ${demo ? "(demo) " : ""}listening on http://${hostname}:${server.port}`);

  if (!demo) {
    startSyncLoop(() => void classifyPending());
    startUpdateChecks();
    // up on the installed binary: the copy of the one before it, kept in case the restart failed, can go
    if (process.execPath === installedBin()) dropBackup(installedBin());
  }

  const stop = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return server;
}
