import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import { obter } from "@/lib/api";
import { estaSolto } from "@/lib/sessao";
import { comDia, diaPedido } from "@/lib/dia";
import { PainelDoAgente } from "@/pages/painel";
import { VistaDaEquipa } from "@/pages/equipa";
import type { AgentePainel } from "@/lib/tipos";

/**
 * Routing and the one piece of chrome the panel has.
 *
 * The team tab is drawn only for a coordinator. That is a courtesy, not a
 * control: the server checks the role on every request to
 * `/api/supervisor/painel`, and hiding the link would be worth nothing if it
 * did not. Hiding it keeps the panel honest about what an agent can do, which
 * matters more than the pixels it saves.
 *
 * The role comes from the panel payload rather than from the token, so a
 * demotion that has already taken effect on the server cannot leave a stale tab
 * on screen.
 */
export function App() {
  const { data } = useQuery<AgentePainel>({
    // Same key and same URL as the panel page: two different keys would fetch
    // the panel twice and could disagree about the role.
    queryKey: ["painel", diaPedido()],
    queryFn: () => obter<AgentePainel>(comDia("/api/agente/painel")),
    staleTime: 60_000,
  });

  const eSupervisor = data?.colaborador.papel === "supervisor";

  return (
    // Express mounts the panel at /agente, so every route and link is relative
    // to it. Without the base, "/equipa" would leave the app entirely.
    <Router base="/agente">
      <div className="min-h-screen bg-background text-foreground">
        {eSupervisor && <Abas />}
        <Switch>
          <Route path="/equipa" component={VistaDaEquipa} />
          <Route component={PainelDoAgente} />
        </Switch>
        {estaSolto() && <NotaDeJanelaSolta />}
      </div>
    </Router>
  );
}

function Abas() {
  const [local] = useLocation();
  const naEquipa = local.startsWith("/equipa");

  return (
    <nav className="sticky top-0 z-10 flex gap-1 border-b bg-background/95 px-3 py-2 backdrop-blur">
      <Aba para="/" activa={!naEquipa}>
        O meu dia
      </Aba>
      <Aba para="/equipa" activa={naEquipa}>
        A equipa
      </Aba>
    </nav>
  );
}

function Aba({
  para,
  activa,
  children,
}: {
  para: string;
  activa: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={para}
      className={
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
        (activa ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </Link>
  );
}

/**
 * Shown when the panel was opened outside the Desk widget.
 *
 * Without it, an expired token in a standalone tab produces a blank panel with
 * no explanation — the recovery path (ask the parent frame for a new token)
 * silently does nothing when there is no parent frame. Saying so beats leaving
 * someone staring at an empty page.
 */
function NotaDeJanelaSolta() {
  return (
    <p className="px-4 pb-6 text-[11px] leading-relaxed text-muted-foreground">
      Este painel foi aberto fora do Zoho Desk. A sessão dura 15 minutos e não se
      renova sozinha aqui — abre-o pelo Desk para deixar de ter de recarregar.
    </p>
  );
}
