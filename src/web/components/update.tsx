import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { buildLabel, dismissUpdate, runUpdate, useUpdateProgress, useUpdateStatus, useUpdateWatch } from "@/hooks/update";
import { api, type UpdateStatus } from "@/lib/api";
import { Button } from "./ui/button";

const ago = (ms: number) => {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
};

/** Where it stands, in one line: the same words in Settings and the notice. */
function progressText(s: UpdateStatus | undefined, phase: string) {
  if (phase === "installing") return "Downloading and checking the new build…";
  if (phase === "restarting") return "Restarting Tern on the new build…";
  if (s?.installed) return `Installed ${buildLabel(s.installed)}. Restart Tern to start using it.`;
  return null;
}

/** Settings › Updates: this build, the newest one, and the buttons. */
export function UpdateSection() {
  const qc = useQueryClient();
  const { data: s } = useUpdateStatus();
  const { phase, error } = useUpdateProgress();
  const check = useMutation({
    mutationFn: api.checkForUpdate,
    onMutate: () => useUpdateProgress.setState({ error: null }),
    onSuccess: (status) => qc.setQueryData(["update"], status),
  });
  // just started (just updated, say), the server hasn't looked yet: look now rather than say "not checked"
  const unchecked = !!s?.current && !s.demo && !s.checkedAt && !s.checking;
  useEffect(() => {
    if (unchecked) check.mutate();
  }, [unchecked]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = phase !== "idle";
  const progress = progressText(s, phase);
  const failure = error ?? s?.error ?? (check.error as Error | null)?.message ?? s?.checkError;

  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-[13px] font-semibold">Updates</h3>
        <p className="text-[12px] text-muted-foreground">
          Tern looks for a newer build of the edge release when it starts and every few hours. Nothing installs until you click Update; accounts, mail and settings stay as they are.
        </p>
      </div>
      <div className="space-y-2 rounded-lg border p-3 text-[13px]">
        <div className="flex items-center gap-3">
          <span className="w-36 shrink-0 text-muted-foreground">This build</span>
          <span className="font-mono text-[12px]">{s ? (s.current ? buildLabel(s.current) : "from source") : "…"}</span>
        </div>
        {s?.latest && (
          <div className="flex items-center gap-3">
            <span className="w-36 shrink-0 text-muted-foreground">Newest on edge</span>
            <span className="font-mono text-[12px]">{buildLabel(s.latest)}</span>
          </div>
        )}
        <p className="text-[12px] text-muted-foreground" aria-live="polite">
          {progress ??
            (!s
              ? "Asking Tern…"
              : !s.current
                ? "This Tern runs from source, so it updates with git: git pull, then bun run build."
                : s.available
                  ? `Update available.${s.demo ? " This is the demo: updating is off." : ""}`
                  : check.isPending || s.checking
                    ? "Checking…"
                    : s.checkedAt && !s.checkError
                      ? `Up to date. Checked ${ago(s.checkedAt)}.`
                      : "Not checked yet.")}
        </p>
        {failure && !busy && <p className="text-[12px] text-destructive">{failure}</p>}
        {s?.current && (
          <div className="flex gap-2 pt-0.5">
            {s.available && (
              <Button size="sm" disabled={busy || s.demo} onClick={() => void runUpdate(qc)}>
                {phase === "installing" ? "Updating…" : phase === "restarting" ? "Restarting…" : "Update"}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy || check.isPending} onClick={() => check.mutate()}>
              {check.isPending ? "Checking…" : "Check for updates"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The one quiet line in the app that offers a newer build. "Not now" hides it until the next one. */
export function UpdateNotice() {
  useUpdateWatch();
  const qc = useQueryClient();
  const { data: s } = useUpdateStatus();
  const { phase, error, dismissed } = useUpdateProgress();
  const progress = progressText(s, phase);
  const offer = s?.available && s.latest && s.latest.sha !== dismissed;
  if (!offer && !progress) return null;

  return (
    <div role="status" className="mx-2 mb-2 space-y-1 rounded-md border bg-background/60 px-2.5 py-2 text-[12px]">
      {progress ? (
        <p className="text-muted-foreground">{progress}</p>
      ) : (
        <>
          <p className="font-medium">Update available</p>
          {s?.latest && <p className="text-muted-foreground">Tern {buildLabel(s.latest)}</p>}
          {error && <p className="text-destructive">{error}</p>}
          <div className="flex gap-3 pt-0.5">
            <button
              className="rounded-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
              onClick={() => void runUpdate(qc)}
            >
              {error ? "Try again" : "Update"}
            </button>
            <button className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand" onClick={() => s?.latest && dismissUpdate(s.latest.sha)}>
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
