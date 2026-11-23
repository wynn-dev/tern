// Set by scripts/compile.ts (`bun build --define`); absent when running from source.
declare const TERN_BUILD_SHA: string | undefined;
declare const TERN_BUILD_TIME: string | undefined;

/** A build of Tern: the main commit it was built from and when (ISO 8601). The edge release publishes its own as build.json. */
export type Build = { sha: string; time: string };

/** This binary's build, or null when running from source (`bun src/cli/main.ts`). */
export const thisBuild: Build | null =
  typeof TERN_BUILD_SHA === "string" && TERN_BUILD_SHA ? { sha: TERN_BUILD_SHA, time: typeof TERN_BUILD_TIME === "string" ? TERN_BUILD_TIME : "" } : null;

export const shortSha = (sha: string) => sha.slice(0, 7);

/** "9b54edf, 2026-11-10": what `tern version` prints after the version. */
export const describeBuild = (b: Build | null) => (b ? `${shortSha(b.sha)}, ${b.time.slice(0, 10) || "unknown date"}` : "from source");
