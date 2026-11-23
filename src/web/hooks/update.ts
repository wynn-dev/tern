import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { create } from "zustand";
import { api, type Build } from "@/lib/api";
import { toast } from "@/lib/toast";

/** "9b54edf · Nov 23, 2026" */
export const buildLabel = (b: Build) => {
  const t = Date.parse(b.time);
  const date = Number.isNaN(t) ? "" : ` · ${new Date(t).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}`;
  return `${b.sha.slice(0, 7)}${date}`;
};

/** How long to wait for Tern to come back on the new build before saying it didn't. */
const RESTART_TIMEOUT_MS = 90_000;
const DISMISSED = "tern-update-dismissed";

type Progress = {
  /** installing: downloading and replacing; restarting: waiting for Tern to come back on `target`. */
  phase: "idle" | "installing" | "restarting";
  target: Build | null;
  since: number;
  error: string | null;
  /** The edge commit "Not now" was clicked on: the notice stays away until a newer one. */
  dismissed: string | null;
};

export const useUpdateProgress = create<Progress>(() => ({
  phase: "idle", target: null, since: 0, error: null, dismissed: typeof localStorage === "undefined" ? null : localStorage.getItem(DISMISSED),
}));

export const dismissUpdate = (sha: string) => {
  localStorage.setItem(DISMISSED, sha);
  useUpdateProgress.setState({ dismissed: sha, error: null });
};

/** What the server knows about updates. It checks GitHub itself; this only asks the server, so it can ask often. */
export function useUpdateStatus() {
  const restarting = useUpdateProgress((s) => s.phase === "restarting");
  return useQuery({
    queryKey: ["update"],
    queryFn: api.updateStatus,
    staleTime: 60_000,
    // while Tern restarts, ask every second for the new build; otherwise pick up the server's own checks now and then
    refetchInterval: restarting ? 1_000 : 30 * 60_000,
    retry: restarting ? false : 1,
  });
}

/** Clicked Update: install, then follow the restart until Tern answers on the new build. */
export async function runUpdate(qc: ReturnType<typeof useQueryClient>) {
  if (useUpdateProgress.getState().phase !== "idle") return;
  useUpdateProgress.setState({ phase: "installing", error: null });
  try {
    const r = await api.installUpdate();
    qc.setQueryData(["update"], r.status);
    if (r.next === "restart") return useUpdateProgress.setState({ phase: "restarting", target: r.build, since: Date.now() });
    useUpdateProgress.setState({ phase: "idle" });
    if (r.next === "none") toast("Tern is already on the newest build");
  } catch (e) {
    useUpdateProgress.setState({ phase: "idle", error: (e as Error).message });
  }
}

/**
 * Mounted once (by the notice): while Tern restarts, watch for it to answer on the new build,
 * or say why it didn't. The event stream reconnects by itself and refreshes the rest of the page.
 */
export function useUpdateWatch() {
  const { data } = useUpdateStatus();
  const { phase, target, since } = useUpdateProgress();
  useEffect(() => {
    if (phase !== "restarting" || !target) return;
    if (data?.current?.sha === target.sha) {
      useUpdateProgress.setState({ phase: "idle", target: null });
      toast.success(`Tern updated to ${buildLabel(target)}`, {
        description: "Reload to get the new interface too.",
        action: { label: "Reload", onClick: () => location.reload() },
        duration: 20_000,
      });
    } else if (data?.error && !data.updating) {
      useUpdateProgress.setState({ phase: "idle", target: null, error: data.error });
    }
    const late = setTimeout(
      () => useUpdateProgress.setState({ phase: "idle", target: null, error: "Tern didn't come back after restarting. Check `tern status` on the machine it runs on." }),
      since + RESTART_TIMEOUT_MS - Date.now(),
    );
    return () => clearTimeout(late);
  }, [data, phase, target, since]);
}
