import { useEffect } from "react";
import { Link, useParams, useSearch } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  Phone,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  Stethoscope,
  ArrowRight,
  Headphones,
  Star,
  Sparkles,
  Ticket,
  ExternalLink,
  User,
  RefreshCw,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  Mail,
} from "lucide-react";
import { useDateContext } from "@/lib/date-context";
import {
  useGetConversation,
  getGetConversationQueryKey,
  type DeskTicket,
  type DeskTicketComment,
  type ConversationLeg,
} from "@workspace/api-client-react";
import { useExchangeRate, formatEur } from "@/lib/use-exchange-rate";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { RichText } from "@/components/rich-text";

type Severidade = "alta" | "media" | "baixa";

const SEVERIDADE_STYLES: Record<Severidade, { dot: string; pill: string; label: string }> = {
  alta: { dot: "bg-red-500", pill: "bg-red-50 text-red-700 border-red-200", label: "ALTA" },
  media: { dot: "bg-amber-500", pill: "bg-amber-50 text-amber-700 border-amber-200", label: "MEDIA" },
  baixa: { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "BAIXA" },
};

const RISCO_STYLES: Record<string, string> = {
  baixo: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medio: "bg-amber-50 text-amber-700 border-amber-200",
  alto: "bg-red-50 text-red-700 border-red-200",
};

const OUTCOME_STYLES: Record<string, { label: string; cls: string }> = {
  won: { label: "Ganho", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  lost: { label: "Perdido", cls: "bg-red-50 text-red-700 border-red-200" },
  open: { label: "Aberto", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  unknown: { label: "Desconhecido", cls: "bg-stone-50 text-stone-600 border-stone-200" },
};

function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return format(new Date(iso), "d MMM yyyy, HH:mm", { locale: ptBR });
  } catch {
    return null;
  }
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3.5 w-3.5 ${n <= value ? "fill-amber-400 text-amber-400" : "text-stone-300"}`}
        />
      ))}
    </span>
  );
}

function SectionTitle({
  icon,
  label,
  color = "text-muted-foreground",
}: {
  icon: React.ReactNode;
  label: string;
  color?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider", color)}>
      {icon}
      {label}
    </div>
  );
}

// ── Unified Timeline ──────────────────────────────────────────────────────────

type TimelineEvent =
  | { kind: "call"; time: Date; leg: ConversationLeg }
  | { kind: "ticket"; time: Date; ticket: DeskTicket }
  | { kind: "comment"; time: Date; comment: DeskTicketComment; ticketSubject: string | null; ticketNumber: string | null };

function buildTimeline(
  legs: ConversationLeg[],
  tickets: DeskTicket[],
  convCreatedAt: string,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const leg of legs) {
    const t = leg.startTime ? new Date(leg.startTime) : new Date(convCreatedAt);
    events.push({ kind: "call", time: t, leg });
  }

  for (const ticket of tickets) {
    if (ticket.createdTime) {
      events.push({ kind: "ticket", time: new Date(ticket.createdTime), ticket });
    }
    for (const comment of ticket.comments) {
      if (comment.commentedTime) {
        events.push({
          kind: "comment",
          time: new Date(comment.commentedTime),
          comment,
          ticketSubject: ticket.subject ?? null,
          ticketNumber: ticket.ticketNumber ?? null,
        });
      }
    }
  }

  events.sort((a, b) => a.time.getTime() - b.time.getTime());
  return events;
}

function TypeTag({
  label,
  color,
}: {
  label: string;
  color: "emerald" | "blue" | "violet" | "amber" | "sky";
}) {
  const cls: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
    blue: "bg-blue-100 text-blue-700 border-blue-200",
    violet: "bg-violet-100 text-violet-700 border-violet-200",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    sky: "bg-sky-100 text-sky-700 border-sky-200",
  };
  return (
    <span className={cn("text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border", cls[color])}>
      {label}
    </span>
  );
}

function CallEventRow({ leg }: { leg: ConversationLeg }) {
  const isInbound =
    leg.direction === "in" ||
    leg.direction === "inbound" ||
    leg.direction === "incoming";
  const Icon = isInbound ? PhoneIncoming : PhoneOutgoing;
  const iconCls = isInbound ? "text-emerald-600" : "text-blue-600";
  const label = isInbound ? "Chamada Entrada" : "Chamada Saída";
  const color = isInbound ? "emerald" : "blue";
  const rowBg = isInbound
    ? "bg-emerald-50/60 border-l-[3px] border-emerald-400"
    : "bg-blue-50/60 border-l-[3px] border-blue-400";
  const duration = formatDuration(leg.durationSec);

  return (
    <div className={cn("flex items-start gap-3 py-2.5 px-2.5 rounded-md", rowBg)}>
      <div className="flex-shrink-0 w-5 flex items-center justify-center mt-0.5">
        <Icon className={cn("h-4 w-4", iconCls)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeTag label={label} color={color} />
          {leg.agentName && (
            <span className="text-xs font-medium text-foreground/80">{leg.agentName}</span>
          )}
          {duration && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {duration}
            </Badge>
          )}
        </div>
        {leg.startTime && (
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
            {formatShortDate(leg.startTime)}
          </p>
        )}
        {leg.ringoverSummary && (
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed italic">
            {leg.ringoverSummary}
          </p>
        )}
      </div>
    </div>
  );
}

function TicketEventRow({ ticket }: { ticket: DeskTicket }) {
  const outcome = ticket.outcomeStatus ? OUTCOME_STYLES[ticket.outcomeStatus] ?? null : null;
  return (
    <div className="flex items-start gap-3 py-2.5 px-2.5 rounded-md bg-violet-50/60 border-l-[3px] border-violet-400">
      <div className="flex-shrink-0 w-5 flex items-center justify-center mt-0.5">
        <Ticket className="h-4 w-4 text-violet-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeTag label="Zoho Desk" color="violet" />
          {ticket.ticketNumber && (
            <span className="font-mono text-xs text-muted-foreground">#{ticket.ticketNumber}</span>
          )}
          <span className="text-sm font-medium leading-snug">{ticket.subject ?? "(sem assunto)"}</span>
          {outcome && (
            <Badge variant="outline" className={cn("text-[10px]", outcome.cls)}>
              {outcome.label}
            </Badge>
          )}
          {ticket.status && (
            <Badge variant="outline" className="text-[10px]">
              {ticket.status}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 mt-0.5 text-[10px] text-muted-foreground">
          {ticket.createdTime && <span className="font-mono">{formatShortDate(ticket.createdTime)}</span>}
          {ticket.category && <span>{ticket.category}</span>}
          {ticket.assigneeName && <span>→ {ticket.assigneeName}</span>}
          {ticket.ticketNumber && (
            <a
              href={`https://desk.zoho.eu/agent/alfaseguros/tickets/${ticket.ticketNumber}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-violet-600 hover:underline"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              Abrir no Zoho
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentEventRow({
  comment,
  ticketSubject,
  ticketNumber,
}: {
  comment: DeskTicketComment;
  ticketSubject: string | null;
  ticketNumber: string | null;
}) {
  const isInternal = comment.authorType !== "END_USER";
  const isMail = comment.channel?.toLowerCase().includes("mail");

  const rowBg = isInternal
    ? "bg-amber-50/60 border-l-[3px] border-amber-400"
    : "bg-sky-50/60 border-l-[3px] border-sky-400";
  const iconColor = isInternal ? "text-amber-600" : "text-sky-600";
  const tagColor: "amber" | "sky" = isInternal ? "amber" : "sky";
  const tagLabel = isInternal ? "Nota interna" : isMail ? "Email cliente" : "Mensagem cliente";
  const Icon = isInternal ? MessageSquare : isMail ? Mail : MessageSquare;

  return (
    <div className={cn("flex items-start gap-3 py-2.5 px-2.5 rounded-md", rowBg)}>
      <div className="flex-shrink-0 w-5 flex items-center justify-center mt-0.5">
        <Icon className={cn("h-4 w-4", iconColor)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeTag label={tagLabel} color={tagColor} />
          {comment.authorName && (
            <span className="text-xs font-medium text-foreground/80">{comment.authorName}</span>
          )}
          {ticketNumber && (
            <span className="text-[10px] font-mono text-muted-foreground">#{ticketNumber}</span>
          )}
        </div>
        {comment.commentedTime && (
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
            {formatShortDate(comment.commentedTime)}
          </p>
        )}
        {comment.content && (
          <p className="mt-1 text-xs text-foreground/70 leading-relaxed line-clamp-4">
            {comment.content}
          </p>
        )}
      </div>
    </div>
  );
}

function InterleaveTimeline({
  legs,
  tickets,
  convCreatedAt,
}: {
  legs: ConversationLeg[];
  tickets: DeskTicket[];
  convCreatedAt: string;
}) {
  const events = buildTimeline(legs, tickets, convCreatedAt);
  const hasContent = events.length > 0;

  const callCount = events.filter((e) => e.kind === "call").length;
  const ticketCount = events.filter((e) => e.kind === "ticket").length;
  const commentCount = events.filter((e) => e.kind === "comment").length;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3">
        <SectionTitle
          icon={<Clock className="h-3.5 w-3.5" />}
          label={`Linha do Tempo${hasContent ? ` · ${events.length} eventos` : ""}`}
          color="text-violet-700"
        />
        {ticketCount > 0 && (
          <p className="text-[10px] text-muted-foreground -mt-2 mb-1">
            Tickets Zoho do mesmo contacto nos 60 dias anteriores a esta conversa. Podem incluir assuntos distintos se o contacto tratar de vários casos.
          </p>
        )}
      </div>

      {hasContent ? (
        <>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[10px] text-muted-foreground">
            {callCount > 0 && (
              <span className="flex items-center gap-1">
                <PhoneIncoming className="h-3 w-3 text-emerald-600" />
                {callCount} {callCount === 1 ? "chamada" : "chamadas"}
              </span>
            )}
            {ticketCount > 0 && (
              <span className="flex items-center gap-1">
                <Ticket className="h-3 w-3 text-violet-600" />
                {ticketCount} ticket{ticketCount !== 1 ? "s" : ""}
              </span>
            )}
            {commentCount > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3 text-indigo-500" />
                {commentCount} {commentCount === 1 ? "comentário" : "comentários"}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            {events.map((ev, i) => {
              if (ev.kind === "call") return <CallEventRow key={i} leg={ev.leg} />;
              if (ev.kind === "ticket") return <TicketEventRow key={i} ticket={ev.ticket} />;
              return (
                <CommentEventRow
                  key={i}
                  comment={ev.comment}
                  ticketSubject={ev.ticketSubject}
                  ticketNumber={ev.ticketNumber}
                />
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum evento de linha do tempo disponível. Os dados detalhados de chamadas e tickets ficam disponíveis após a próxima análise.
        </p>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ConversaDetalhe() {
  const params = useParams<{ id: string }>();
  const search = useSearch();
  const { dateStr: ctxDate, setSelectedDate } = useDateContext();
  const conversationId = parseInt(params.id ?? "", 10);

  // Allow deep-links from the daily-summary email: /conversas/:id?date=YYYY-MM-DD.
  // The API requires the conversation's runDate, so prefer the URL date over the
  // global context, and sync the context so the rest of the page stays coherent.
  const dateParam = new URLSearchParams(search).get("date");
  const validDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  const dateStr = validDate ?? ctxDate;

  useEffect(() => {
    if (validDate && validDate !== ctxDate) {
      setSelectedDate(new Date(`${validDate}T12:00:00`));
    }
  }, [validDate, ctxDate, setSelectedDate]);

  const { data: conv, isLoading } = useGetConversation(dateStr, conversationId, {
    query: {
      enabled: !!dateStr && !isNaN(conversationId),
      queryKey: getGetConversationQueryKey(dateStr, conversationId),
    },
  });

  const { data: fxData } = useExchangeRate();
  const eurRate = fxData?.rate ?? null;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!conv) {
    return (
      <div className="space-y-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">Conversa não encontrada.</p>
        </div>
      </div>
    );
  }

  const a = conv.analysis;
  const duration = formatDuration(conv.durationSec);
  const riscoClass = a?.riscoPerdaLead ? RISCO_STYLES[a.riscoPerdaLead] : null;
  const tickets = conv.tickets ?? [];
  const legs = conv.legs ?? [];

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ── Back + Header ── */}
      <div className="flex items-start gap-3">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground transition-colors mt-1"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-xl font-bold tracking-tight">{conv.customerPhone}</h1>
            {conv.agentName && (
              <>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{conv.agentName}</span>
              </>
            )}
            {duration && (
              <Badge variant="outline" className="font-mono text-xs">
                {duration}
              </Badge>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {format(new Date(conv.createdAt), "d 'de' MMMM, HH:mm", { locale: ptBR })}
            </span>
            <span>·</span>
            <span>
              {conv.callIds.length} {conv.callIds.length === 1 ? "chamada" : "chamadas"}
            </span>
            {tickets.length > 0 && (
              <>
                <span>·</span>
                <span>{tickets.length} ticket{tickets.length !== 1 ? "s" : ""} Zoho</span>
              </>
            )}
            {conv.costUsd != null && conv.costUsd > 0 && (
              <>
                <span>·</span>
                <span className="tabular-nums">{formatEur(conv.costUsd, eurRate)}</span>
              </>
            )}
          </div>

          {/* Chips */}
          {a && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {a.produto && (
                <Badge variant="secondary" className="text-xs uppercase tracking-wide">
                  {a.produto}
                </Badge>
              )}
              {a.categoria && (
                <Badge variant="outline" className="text-xs">
                  {a.categoria}
                </Badge>
              )}
              {a.arcoConversa && (
                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                  {a.arcoConversa}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs gap-1">
                <Stars value={a.qualidadeGlobal} />
              </Badge>
              {a.riscoPerdaLead && riscoClass && (
                <Badge variant="outline" className={`text-xs ${riscoClass}`}>
                  Risco {a.riscoPerdaLead}
                </Badge>
              )}
              {a.desviosProcedimento.length > 0 && (
                <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                  {a.desviosProcedimento.length}{" "}
                  {a.desviosProcedimento.length === 1 ? "desvio" : "desvios"}
                </Badge>
              )}
              {a.followUpNecessario && (
                <Badge variant="outline" className="text-xs">
                  → follow-up
                </Badge>
              )}
              {a.tags?.map((t) => (
                <Badge key={t} variant="outline" className="text-xs text-muted-foreground">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {a ? (
        <div className="space-y-4">

          {/* ── 1. NARRATIVE — full width ── */}
          <div className="rounded-lg border-l-4 border-l-stone-900 bg-card border border-l-stone-900 p-5 space-y-3">
            <p
              className="text-base leading-relaxed text-foreground/90 whitespace-pre-line"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              <RichText text={a.narrativaConversa} />
            </p>
            {a.sentimentoClienteEvolucao && (
              <p className="text-xs italic text-muted-foreground leading-relaxed pt-2 border-t">
                <RichText text={a.sentimentoClienteEvolucao} />
              </p>
            )}
          </div>

          {/* Continuidade warning — full width, only when present */}
          {a.continuidade && (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">
                Continuidade
              </p>
              <p className="text-sm text-amber-900 leading-relaxed"><RichText text={a.continuidade} /></p>
            </div>
          )}

          {/* ── 2. PONTOS POSITIVOS | DESVIOS | FEEDBACK — 3 columns ── */}
          <div className="grid gap-4 lg:grid-cols-3">

            {/* Pontos Positivos */}
            {a.pontosPositivos.length > 0 && (
              <div className="rounded-lg border bg-card p-4">
                <SectionTitle
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  label="Pontos Positivos"
                  color="text-emerald-700"
                />
                <ul className="space-y-3">
                  {a.pontosPositivos.map((p, i) => (
                    <li key={i} className="text-sm flex items-start gap-2 leading-relaxed">
                      <span className="text-emerald-500 mt-1 flex-shrink-0">✓</span>
                      <span className="text-foreground/80"><RichText text={p} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Desvios de Procedimento */}
            {a.desviosProcedimento.length > 0 && (
              <div className="rounded-lg border bg-card p-4">
                <SectionTitle
                  icon={<AlertTriangle className="h-3.5 w-3.5" />}
                  label="Desvios de Procedimento"
                  color="text-amber-700"
                />
                <ul className="space-y-3">
                  {a.desviosProcedimento.map((d, i) => {
                    const sev = SEVERIDADE_STYLES[d.severidade as Severidade] ?? SEVERIDADE_STYLES.media;
                    return (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${sev.dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border ${sev.pill}`}>
                              {sev.label}
                            </span>
                            <span className="text-sm font-medium leading-snug">{d.titulo}</span>
                            {d.chamadaEspecifica && (
                              <span className="text-[10px] font-mono text-muted-foreground">
                                {d.chamadaEspecifica}
                              </span>
                            )}
                          </div>
                          {d.detalhe && (
                            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                              {d.detalhe}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Feedback Supervisor */}
            {a.feedbackSupervisor && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-4">
                <SectionTitle
                  icon={<MessageSquare className="h-3.5 w-3.5" />}
                  label="Feedback Supervisor"
                  color="text-amber-700"
                />
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                  <RichText text={a.feedbackSupervisor} />
                </p>
              </div>
            )}
          </div>

          {/* ── 3. SUGESTÃO + FOLLOW-UP — 2 columns ── */}
          {(a.sugestaoEspecialista || (a.followUpNecessario && a.followUpDescricao)) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {a.sugestaoEspecialista && (
                <div className="rounded-lg border border-cyan-200 bg-cyan-50/30 p-4">
                  <SectionTitle
                    icon={<Stethoscope className="h-3.5 w-3.5" />}
                    label="Sugestão do Especialista"
                    color="text-cyan-700"
                  />
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                    <RichText text={a.sugestaoEspecialista} />
                  </p>
                </div>
              )}

              {a.followUpNecessario && a.followUpDescricao && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
                  <SectionTitle
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    label="Follow-up Necessário"
                    color="text-blue-700"
                  />
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                    <RichText text={a.followUpDescricao} />
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── 4. TIMELINE (calls + tickets + comments interleaved) ── */}
          <InterleaveTimeline
            legs={legs}
            tickets={tickets}
            convCreatedAt={conv.createdAt}
          />

          {/* ── 5. RECORDINGS + CALL IDs ── */}
          {(conv.recordingUrls.length > 0 || conv.callIds.length > 0) && (
            <div className="flex flex-wrap items-center gap-4 pt-1">
              {conv.recordingUrls.map((url, i) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Headphones className="h-3.5 w-3.5" />
                  Gravação {conv.recordingUrls.length > 1 ? i + 1 : ""}
                </a>
              ))}
              <div className="flex flex-wrap gap-1.5">
                {conv.callIds.map((id) => (
                  <Badge key={id} variant="outline" className="font-mono text-[10px]">
                    {id}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Even without analysis, show the timeline if we have tickets/legs */}
          {(legs.length > 0 || tickets.length > 0) && (
            <InterleaveTimeline
              legs={legs}
              tickets={tickets}
              convCreatedAt={conv.createdAt}
            />
          )}

          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Análise ainda não disponível para esta conversa.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
