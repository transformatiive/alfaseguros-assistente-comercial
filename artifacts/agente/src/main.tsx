import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { anunciarPresenca, arrancarSessao } from "./lib/sessao";
import { SessaoExpirada } from "./lib/api";
import "./index.css";

// Before anything renders: take the token out of the URL. A component that
// mounted first could fire a request with no token and produce a spurious 401.
arrancarSessao();

// And tell the Desk widget we got this far. It has no other way to know: a
// frame the portal's CSP refused to load looks exactly like one that loaded
// and drew nothing.
anunciarPresenca();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Never retry an expired session: the recovery is the widget re-minting
      // and reloading, and retrying only delays it while looking like a hang.
      retry: (contagem, erro) => !(erro instanceof SessaoExpirada) && contagem < 2,
      refetchOnWindowFocus: true,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root não encontrado");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
