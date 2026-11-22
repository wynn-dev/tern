import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CommandPalette } from "./components/command-palette";
import { Composer } from "./components/composer";
import { Reader } from "./components/reader";
import { SettingsDialog } from "./components/settings";
import { Sidebar } from "./components/sidebar";
import { ThreadList } from "./components/thread-list";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { useAccounts, useLiveUpdates } from "./hooks/data";
import { SHORTCUTS, useKeyboard } from "./hooks/keyboard";
import { api } from "./lib/api";
import { useStore } from "./lib/store";

export function App() {
  const { data: session, refetch } = useQuery({ queryKey: ["session"], queryFn: api.session });
  if (!session) return null;
  if (!session.authed) return <SignIn onDone={() => void refetch()} />;
  return <Mail />;
}

function Mail() {
  useLiveUpdates();
  useKeyboard();
  const { data, isSuccess } = useAccounts();
  const set = useStore((s) => s.set);

  // results of the Google sign-in redirect
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("connected")) toast.success(`Connected ${p.get("connected")}`, { description: "Pulling in your recent mail…" });
    if (p.get("error")) toast.error(p.get("error")!);
    if (p.has("connected") || p.has("error")) {
      p.delete("connected");
      p.delete("error");
      history.replaceState(history.state, "", location.pathname + (p.size ? `?${p}` : ""));
    }
  }, []);

  useEffect(() => {
    if (isSuccess && !data.accounts.length) set({ settingsOpen: true });
  }, [isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full">
      <Sidebar />
      <ThreadList />
      <Reader />
      <Composer />
      <CommandPalette />
      <SettingsDialog />
      <ShortcutsDialog />
    </div>
  );
}

function ShortcutsDialog() {
  const { helpOpen, set } = useStore();
  return (
    <Dialog open={helpOpen} onOpenChange={(o) => set({ helpOpen: o })}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <div className="-mt-1 divide-y">
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between py-1.5 text-[13px]">
              <span className="text-muted-foreground">{label}</span>
              <span className="flex gap-1">
                {k.split(" ").map((p, i) => (p === "/" && k !== "/") || p === "then" || p === "·" ? <span key={i} className="px-0.5 text-[11px] text-muted-foreground">{p}</span> : <kbd key={i}>{p}</kbd>)}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const m = useMutation({ mutationFn: () => api.signIn(pw), onSuccess: onDone });
  return (
    <div className="flex h-full items-center justify-center bg-sidebar">
      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.2, 0.9, 0.1, 1] }}
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
        className="w-[320px] space-y-4 rounded-xl border bg-card p-6 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="size-6">
            <rect width="32" height="32" rx="8" className="fill-foreground" />
            <path d="M6 20c4-1 7-4 10-9 2 4 5 7 10 8-5 0-8 1-10 5-2-3-5-4-10-4z" className="fill-background" />
          </svg>
          <span className="text-[16px] font-semibold tracking-tight">Tern</span>
        </div>
        <Input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" />
        {m.error && <p className="text-[12px] text-destructive">{m.error.message}</p>}
        <Button className="w-full" disabled={!pw || m.isPending}>
          {m.isPending && <Loader2Icon className="animate-spin" />} Sign in
        </Button>
      </motion.form>
    </div>
  );
}
