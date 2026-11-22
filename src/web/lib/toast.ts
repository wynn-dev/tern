import { toast as sonner } from "sonner";
import { sessionEnded } from "./api";

/**
 * sonner's toast, except that errors stay quiet once the session has ended: the sign-in dialog
 * already says why, and "Not sent: Sign in first" on top of it says nothing more. An error that
 * would replace a toast (`id`) dismisses it instead, so a "Checking…" doesn't spin forever.
 */
export const toast = Object.assign((...a: Parameters<typeof sonner>) => sonner(...a), sonner, {
  error: (...[message, data]: Parameters<typeof sonner.error>) => {
    if (!sessionEnded()) return sonner.error(message, data);
    if (data?.id !== undefined) sonner.dismiss(data.id);
    return data?.id;
  },
});
