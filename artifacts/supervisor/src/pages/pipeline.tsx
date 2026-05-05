import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Phone,
  Ticket,
  PhoneIncoming,
  PhoneOutgoing,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  Star,
  AlertTriangle,
} from "lucide-react";
import { useDateContext } from "@/lib/date-context";
import {
  useListCases,
  getListCasesQueryKey,
  type CaseSummary,
  type CaseLeg,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const OUTCOME_STYLES: Record<string, { label: string; cls: string }> = {
  won: { label: "Ganho", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  lost: { label: "Perdido", cls: "bg-red-50 text-red-700 border-red-200" },
  open: { label: "Aberto", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  unknown: { label: "—", cls: "bg-stone-50 text-stone-500 border-stone-200" },
};

const RISK_PILL: Record<string, string> = {
  baixo: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medio: "bg-amber-50 text-amber-700 border-amber-200",
  alto: "bg-red-50 text-red-700 border-red-200",
};

function formatTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "d MMM, HH:mm", { locale: ptBR });
  } catch {
    return "—";
  }
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-2.5 w-2.5 ${n <= value ? "fill-amber-400 text-amber-400" : "text-stone-300"}`}
        />
      ))}
    </span>
  );
}

function LegRow({ leg, dateStr }: { leg: CaseLeg; dateStr: string }) {
  const isCall = leg.kind === "call";
  const isComment = leg.kind === "ticket_comment";
  const isInbound =
    leg.label.toLowerCase().includes("inbound") ||
    leg.label.toLowerCase().includes("entrada");

  const icon = isCall ? (
    isInbound ? (
      <PhoneIncoming className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
    ) : (
      <PhoneOutgoing className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
    )
  ) : isComment ? (
    <MessageSquare className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
  ) : (
    <Ticket className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
  );

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-dashed border-border/50 last:border-0">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-foreground">{leg.label}</span>
          {leg.agentName && (
            <span className="text-[10px] text-muted-foreground">{leg.agentName}</span>
          )}
          {leg.channel && (
            <Badge variant="outline" className="text-[10px] py-0 h-4">
              {leg.channel}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground font-mono">
            {formatTs(leg.at)}
          </span>
        </div>
        {leg.detail && (
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
            {leg.detail}
          </p>
        )}
        {isCall && leg.conversationId != null && (
          <Link
            href={`/conversas/${leg.conversationId}`}
            className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-primary hover:underline"
          >
            Ver conversa
            <ArrowUpRight className="h-2.5 w-2.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

function CaseCard({ c, dateStr }: { c: CaseSummary; dateStr: string }) {
  const [open, setOpen] = useState(false);
  const outcome = OUTCOME_STYLES[c.outcomeStatus] ?? OUTCOME_STYLES.unknown;
  const a = c.analysis;

  const callCount = c.timeline.filter((l) => l.kind === "call").length;
  const ticketCount = c.ticketIds.length;

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="mt-1">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-mono text-sm font-semibold">
              {c.customerPhone ?? "(sem telefone)"}
            </span>
            {c.customerName && (
              <span className="text-sm text-muted-foreground">{c.customerName}</span>
            )}
            <Badge variant="outline" className={cn("text-[10px]", outcome.cls)}>
              {outcome.label}
            </Badge>
            {a?.riscoPerdaLead && a.riscoPerdaLead !== "baixo" && (
              <Badge variant="outline" className={cn("text-[10px]", RISK_PILL[a.riscoPerdaLead])}>
                <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                Risco {a.riscoPerdaLead}
              </Badge>
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
            {c.productName && <span>{c.productName}</span>}
            {c.primaryAgentName && <span>Operador: {c.primaryAgentName}</span>}
            <span>
              {callCount} {callCount === 1 ? "chamada" : "chamadas"}
              {ticketCount > 0 && ` · ${ticketCount} ticket${ticketCount === 1 ? "" : "s"}`}
            </span>
            {c.lastActivityAt && (
              <span>Última atividade: {formatTs(c.lastActivityAt)}</span>
            )}
          </div>

          {a && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {a.categoria && (
                <Badge variant="outline" className="text-[10px]">
                  {a.categoria}
                </Badge>
              )}
              {a.produto && (
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                  {a.produto}
                </Badge>
              )}
              <Stars value={a.qualidadeGlobal} />
            </div>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="px-4 pb-4 pt-0 border-t space-y-4">
          {/* Analysis narrative */}
          {a?.narrativaConversa && (
            <div className="mt-3 rounded-md border-l-2 border-l-stone-400 bg-muted/30 pl-3 pr-2 py-2">
              <p className="text-xs text-muted-foreground leading-relaxed">{a.narrativaConversa}</p>
            </div>
          )}

          {/* Desvios */}
          {a && a.desviosProcedimento.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                Desvios
              </p>
              {a.desviosProcedimento.map((d, i) => (
                <div key={i} className="text-xs text-amber-900">
                  <span className="font-medium">{d.titulo}</span>
                  {d.detalhe && (
                    <span className="text-muted-foreground"> — {d.detalhe}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Timeline */}
          {c.timeline.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Linha do Tempo ({c.timeline.length} eventos)
              </p>
              <div className="space-y-0">
                {c.timeline.map((leg, i) => (
                  <LegRow key={i} leg={leg} dateStr={dateStr} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Pipeline() {
  const { dateStr } = useDateContext();

  const { data: cases, isLoading } = useListCases(dateStr, {
    query: {
      enabled: !!dateStr,
      queryKey: getListCasesQueryKey(dateStr),
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!cases || cases.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <Ticket className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">
          Sem casos para esta data
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Os casos são criados automaticamente quando a análise do dia inclui tickets Zoho Desk correspondentes.
        </p>
      </div>
    );
  }

  const callOnlyCases = cases.filter((c) => c.ticketIds.length === 0);
  const linkedCases = cases.filter((c) => c.ticketIds.length > 0);

  return (
    <div className="space-y-6">
      {linkedCases.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Casos com ticket Zoho ({linkedCases.length})
          </h3>
          {linkedCases.map((c) => (
            <CaseCard key={c.id} c={c} dateStr={dateStr} />
          ))}
        </section>
      )}

      {callOnlyCases.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Conversas sem ticket ({callOnlyCases.length})
          </h3>
          {callOnlyCases.map((c) => (
            <CaseCard key={c.id} c={c} dateStr={dateStr} />
          ))}
        </section>
      )}
    </div>
  );
}
