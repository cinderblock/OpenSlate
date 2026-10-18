import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { persister, queryClient } from "./lib/query";
import { router } from "./router";
import "./styles.css";

// crypto.randomUUID is only exposed in secure contexts (HTTPS or localhost). On a
// plain-HTTP LAN hostname the browser hides it, which breaks TanStack DB's mutation
// IDs. crypto.getRandomValues is always available, so polyfill from that.
if (typeof globalThis.crypto?.randomUUID !== "function") {
  (globalThis.crypto as { randomUUID: () => string }).randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
    b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
    const h = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
);
