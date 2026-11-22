import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./app";
import { TooltipProvider } from "./components/ui/tooltip";
import "./styles.css";

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 }, mutations: { retry: 0 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <App />
        <Toaster
          position="bottom-center"
          toastOptions={{ className: "!font-sans !text-[13px] !rounded-lg !border-border !bg-popover !text-popover-foreground !shadow-lg" }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
