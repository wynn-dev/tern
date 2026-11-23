// Compiles the single tern binary with its build identity baked in: the commit
// it was built from and when, which `tern version`, Settings and the updater read.
//
//   bun scripts/compile.ts [--target bun-linux-x64] [--outfile dist/tern]
//
// TERN_BUILD_SHA and TERN_BUILD_TIME set the identity (the release workflow sets
// both, so its four binaries and build.json agree); otherwise it's HEAD and now.
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { target: { type: "string" }, outfile: { type: "string", default: "dist/tern" } } });
const git = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stderr: "ignore" });
const sha = process.env.TERN_BUILD_SHA || (git.success ? git.stdout.toString().trim() : "");
const time = process.env.TERN_BUILD_TIME || new Date().toISOString().replace(/\.\d+Z$/, "Z");
if (!sha) throw new Error("no commit to name this build after: set TERN_BUILD_SHA or build from a git checkout");

const args = ["build", "--compile", "--minify", "src/cli/main.ts", "--outfile", values.outfile!];
if (values.target) args.push(`--target=${values.target}`);
args.push("--define", `TERN_BUILD_SHA=${JSON.stringify(sha)}`, "--define", `TERN_BUILD_TIME=${JSON.stringify(time)}`);
const r = Bun.spawnSync([process.execPath, ...args], { stdout: "inherit", stderr: "inherit" });
if (!r.success) process.exit(r.exitCode || 1);
console.log(`${values.outfile}: build ${sha.slice(0, 7)} at ${time}`);
