import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon, PlusIcon, RefreshCwIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAccounts } from "@/hooks/data";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

const MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5 — fastest, lightest on your plan" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5 — balanced" },
  { id: "claude-opus-5-5", label: "Opus 5.5 — best writing" },
];

export function SettingsDialog() {
  const { settingsOpen, set } = useStore();
  return (
    <Dialog open={settingsOpen} onOpenChange={(o) => set({ settingsOpen: o })}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[600px]">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription className="-mt-3">Accounts, the Google connection and AI.</DialogDescription>
        {settingsOpen && <SettingsBody />}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function SettingsBody() {
  const qc = useQueryClient();
  const { data: accts } = useAccounts();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: session } = useQuery({ queryKey: ["session"], queryFn: api.session });
  const { data: ai } = useQuery({ queryKey: ["ai-status"], queryFn: api.aiStatus });
  const [paste, setPaste] = useState("");

  const connect = useMutation({
    mutationFn: api.connect,
    onSuccess: ({ url }) => window.open(url, "_self"),
    onError: (e) => toast.error(e.message),
  });
  const complete = useMutation({
    mutationFn: () => api.completeConnect(paste),
    onSuccess: ({ account }) => {
      toast.success(`Connected ${account.email}`);
      setPaste("");
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeAccount(id),
    onSuccess: () => qc.invalidateQueries(),
  });
  const saveAi = useMutation({
    mutationFn: (ai: Parameters<typeof api.saveSettings>[0]["ai"]) => api.saveSettings({ ai }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["settings"] }), qc.invalidateQueries({ queryKey: ["ai-status"] })]),
  });

  return (
    <div className="space-y-7">
      <Section title="Accounts" hint="Every account syncs on its own and lands in one unified inbox.">
        <div className="divide-y rounded-lg border">
          {accts?.accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="size-2 rounded-full" style={{ background: a.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{a.email}</div>
                <div className={cn("text-[12px]", a.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                  {a.status === "error" ? a.error : a.status === "syncing" ? "Syncing…" : "Up to date"}
                </div>
              </div>
              {a.status === "error" && (
                <Button size="sm" variant="outline" onClick={() => connect.mutate()}>
                  Reconnect
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" onClick={() => api.sync(a.id)}>
                <RefreshCwIcon className="!size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => confirm(`Remove ${a.email} from Tern? Its mail is deleted from Tern only, never from Gmail.`) && remove.mutate(a.id)}
              >
                <Trash2Icon className="!size-3.5" />
              </Button>
            </div>
          ))}
          {!accts?.accounts.length && <div className="px-3 py-4 text-[13px] text-muted-foreground">No accounts yet.</div>}
        </div>
        <Button onClick={() => connect.mutate()} disabled={connect.isPending || session?.demo || !settings?.google.configured}>
          {connect.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Add Gmail account
        </Button>
        {session?.demo && <p className="text-[12px] text-muted-foreground">This is the demo: adding accounts is off.</p>}
        {settings?.google.configured && !session?.demo && (
          <details className="text-[12px] text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">Google couldn't send you back here?</summary>
            <p className="mt-2">Copy the address of the page Google sent you to (it starts with {settings.redirectUri}) and paste it here.</p>
            <div className="mt-2 flex gap-2">
              <Input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={`${settings.redirectUri}?code=…`} />
              <Button variant="outline" disabled={!paste || complete.isPending} onClick={() => complete.mutate()}>
                Connect
              </Button>
            </div>
          </details>
        )}
      </Section>

      {!session?.demo && <GoogleSection settings={settings} />}

      <Section title="AI" hint="Runs through Claude Code on this machine, on your Claude subscription. Mail goes only to Claude.">
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <SparklesIcon className="size-4 text-brand" />
            <div className="flex-1 text-[13px]">
              <div className="font-medium">Sort, summarize and draft with Claude</div>
              <div className="text-[12px] text-muted-foreground">
                {settings && !settings.ai.enabled
                  ? "Off. Tern sends nothing to Claude."
                  : !ai?.claudePath
                    ? "Claude Code isn't installed on the server. Install it and run `claude /login` to sign in."
                    : ai.lastError
                      ? `Last error: ${ai.lastError}`
                      : `${ai.classified} conversations sorted since start`}
              </div>
            </div>
            <Toggle on={!!settings?.ai.enabled} onChange={(enabled) => saveAi.mutate({ enabled })} />
          </div>
          <ModelPick label="Sorting" value={settings?.ai.classifyModel} onChange={(classifyModel) => saveAi.mutate({ classifyModel })} />
          <ModelPick label="Summaries & drafts" value={settings?.ai.writeModel} onChange={(writeModel) => saveAi.mutate({ writeModel })} />
        </div>
      </Section>

      {session?.passwordRequired && (
        <Button variant="ghost" onClick={() => api.signOut().then(() => location.reload())}>
          Sign out
        </Button>
      )}
    </div>
  );
}

function GoogleSection({ settings }: { settings?: Awaited<ReturnType<typeof api.settings>> }) {
  const qc = useQueryClient();
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const save = useMutation({
    mutationFn: () => api.saveSettings({ google: { clientId: id, clientSecret: secret } }),
    onSuccess: () => {
      toast.success("Google connection saved");
      setSecret("");
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  if (!settings) return null;
  return (
    <Section title="Google connection" hint="Tern signs in to Gmail through your own Google Cloud OAuth client, so your mail never passes through anyone else.">
      {settings.google.configured ? (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px]">
          <CheckIcon className="size-4 text-emerald-500" />
          <span className="flex-1 truncate">Client {settings.google.clientId.slice(0, 24)}…</span>
        </div>
      ) : (
        <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-muted-foreground">
          <li>
            Create a project in{" "}
            <a className="text-brand" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
              Google Cloud <ExternalLinkIcon className="inline size-3" />
            </a>{" "}
            and enable the{" "}
            <a className="text-brand" href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">
              Gmail API
            </a>
            .
          </li>
          <li>On the OAuth consent screen, pick External, add your Gmail addresses as test users, then Publish app (in Testing, Google signs you out every 7 days).</li>
          <li>Create an OAuth client ID of type Web application with this redirect URI:</li>
        </ol>
      )}
      <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 font-mono text-[12px]">
        <span className="flex-1 truncate">{settings.redirectUri}</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(settings.redirectUri);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="Client ID" />
        <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Client secret" type="password" autoComplete="off" />
      </div>
      <Button variant="outline" disabled={!id || !secret || save.isPending} onClick={() => save.mutate()}>
        {settings.google.configured ? "Replace client" : "Save"}
      </Button>
    </Section>
  );
}

function ModelPick({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-3 text-[13px]">
      <span className="w-36 text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 flex-1 rounded-md border bg-transparent px-2 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 dark:bg-input/30"
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150", on ? "bg-brand" : "bg-input")}
    >
      <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-(--ease-snap)", on && "translate-x-4")} />
    </button>
  );
}
