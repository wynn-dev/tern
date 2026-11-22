import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./app";
import { TooltipProvider } from "./components/ui/tooltip";
import { syncStoreWithUrl } from "./lib/store";
import "./styles.css";

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 }, mutations: { retry: 0 } },
});

syncStoreWithUrl();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        {/* prefers-reduced-motion turns motion's movement off too, as styles.css does for the CSS */}
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
        <Toaster
          position="bottom-center"
          toastOptions={{ className: "!font-sans !text-[13px] !rounded-lg !border-border !bg-popover !text-popover-foreground !shadow-lg" }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
