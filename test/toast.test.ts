import { expect, spyOn, test } from "bun:test";
import { toast as sonner } from "sonner";
import { api, sessionEnded } from "../src/web/lib/api";
import { toast } from "../src/web/lib/toast";

const errors = () => sonner.getToasts().filter((t) => "type" in t && t.type === "error").map((t) => ("title" in t ? t.title : ""));

test("error toasts stay quiet while the sign-in dialog is up, and come back after signing in", async () => {
  const real = globalThis.fetch;
  try {
    toast.error("Couldn't archive: offline");
    expect(errors()).toContain("Couldn't archive: offline");

    // a request refused because the session ended puts up the sign-in dialog
    globalThis.fetch = (async () => Response.json({ error: "Sign in first" }, { status: 401 })) as unknown as typeof fetch;
    const e = await api.send({ accountId: "a", to: "b@x.io", subject: "Hi", text: "" }).catch((e: Error) => e);
    expect(sessionEnded()).toBe(true);
    toast.error(`Not sent: ${(e as Error).message}`);
    expect(errors()).not.toContain("Not sent: Sign in first");

    // one that would replace a "Checking…" toast takes it away instead of leaving it spinning
    const dismiss = spyOn(sonner, "dismiss").mockImplementation((id) => id!);
    const id = toast.loading("Checking for new mail…");
    toast.error("Couldn't check for new mail: Sign in first", { id });
    expect(dismiss).toHaveBeenCalledWith(id);
    expect(errors()).not.toContain("Couldn't check for new mail: Sign in first");
    dismiss.mockRestore();

    globalThis.fetch = (async () => Response.json({ ok: true })) as unknown as typeof fetch;
    await api.signIn("pw");
    expect(sessionEnded()).toBe(false);
    toast.error("Couldn't archive: offline again");
    expect(errors()).toContain("Couldn't archive: offline again");
  } finally {
    globalThis.fetch = real;
  }
});
