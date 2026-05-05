import { Link, useParams } from "wouter";
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
} from "lucide-react";
import { useDateContext } from "@/lib/date-context";
import {
  useGetConversation,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
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

export default function ConversaDetalhe() {
  const params = useParams<{ id: string }>();
  const { dateStr } = useDateContext();
  const conversationId = parseInt(params.id ?? "", 10);

  const { data: conv, isLoading } = useGetConversation(dateStr, conversationId, {
    query: {
      enabled: !!dateStr && !isNaN(conversationId),
      queryKey: getGetConversationQueryKey(dateStr, conversationId),
    },
  });

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
          href="/conversas"
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

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <Link
          href="/conversas"
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
            {conv.costUsd != null && (
              <>
                <span>·</span>
                <span>${conv.costUsd.toFixed(4)}</span>
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
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Left column: narrative + sentiment + positives + recordings */}
          <div className="space-y-4">
            <Card className="border-l-4 border-l-stone-900">
              <CardContent className="pt-4 space-y-2">
                <p
                  className="text-base leading-relaxed text-foreground/90 whitespace-pre-line"
                  style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
                >
                  {a.narrativaConversa}
                </p>
                {a.sentimentoClienteEvolucao && (
                  <p className="text-xs italic text-muted-foreground leading-relaxed pt-1 border-t">
                    {a.sentimentoClienteEvolucao}
                  </p>
                )}
              </CardContent>
            </Card>

            {a.continuidade && (
              <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">
                  Continuidade
                </p>
                <p className="text-sm text-amber-900 leading-relaxed">{a.continuidade}</p>
              </div>
            )}

            {a.pontosPositivos.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Pontos Positivos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {a.pontosPositivos.map((p, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-emerald-600 mt-0.5">✓</span>
                        <span className="text-foreground/80">{p}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {conv.recordingUrls.length > 0 && (
              <div className="flex flex-wrap gap-3">
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
              </div>
            )}
          </div>

          {/* Right column: desvios + supervisor + specialist + follow-up */}
          <div className="space-y-4">
            {a.desviosProcedimento.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Desvios de Procedimento
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {a.desviosProcedimento.map((d, i) => {
                      const sev = SEVERIDADE_STYLES[d.severidade as Severidade] ?? SEVERIDADE_STYLES.media;
                      return (
                        <li key={i} className="flex items-start gap-3">
                          <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${sev.dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border ${sev.pill}`}>
                                {sev.label}
                              </span>
                              <span className="text-sm font-medium">{d.titulo}</span>
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
                </CardContent>
              </Card>
            )}

            {a.feedbackSupervisor && (
              <Card className="border-amber-200 bg-amber-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-amber-700 flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Feedback Supervisor
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                    {a.feedbackSupervisor}
                  </p>
                </CardContent>
              </Card>
            )}

            {a.sugestaoEspecialista && (
              <Card className="border-cyan-200 bg-cyan-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-cyan-700 flex items-center gap-2">
                    <Stethoscope className="h-3.5 w-3.5" />
                    Sugestão do Especialista
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                    {a.sugestaoEspecialista}
                  </p>
                </CardContent>
              </Card>
            )}

            {a.followUpNecessario && a.followUpDescricao && (
              <Card className="border-blue-200 bg-blue-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-blue-700 flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5" />
                    Follow-up Necessário
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                    {a.followUpDescricao}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="lg:col-span-2 flex flex-wrap gap-2 pt-2">
            {conv.callIds.map((id) => (
              <Badge key={id} variant="outline" className="font-mono text-[10px]">
                {id}
              </Badge>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Análise ainda não disponível para esta conversa.
          </p>
        </div>
      )}
    </div>
  );
}
