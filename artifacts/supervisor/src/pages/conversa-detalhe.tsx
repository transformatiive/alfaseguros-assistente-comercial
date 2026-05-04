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
  BookOpen,
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

type Severity = "alta" | "media" | "baixa";

const SEVERITY_STYLES: Record<Severity, { dot: string; pill: string; label: string }> = {
  alta: {
    dot: "bg-red-500",
    pill: "bg-red-50 text-red-700 border-red-200",
    label: "ALTA",
  },
  media: {
    dot: "bg-amber-500",
    pill: "bg-amber-50 text-amber-700 border-amber-200",
    label: "MEDIA",
  },
  baixa: {
    dot: "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "BAIXA",
  },
};

const SENTIMENT_STYLES: Record<string, { emoji: string; label: string }> = {
  positivo: { emoji: "🙂", label: "Positivo" },
  neutro: { emoji: "😐", label: "Neutro" },
  negativo: { emoji: "🙁", label: "Negativo" },
};

const RISK_STYLES: Record<string, string> = {
  baixo: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medio: "bg-amber-50 text-amber-700 border-amber-200",
  alto: "bg-red-50 text-red-700 border-red-200",
};

const TEMPERATURE_LABELS: Record<string, string> = {
  quente: "Lead Quente",
  morno: "Lead Morno",
  frio: "Lead Frio",
  tire_kicker: "Tire-kicker",
  ja_cliente: "Já Cliente",
};

function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
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
  const sentiment = a?.sentiment ? SENTIMENT_STYLES[a.sentiment] : null;
  const riskLevelClass = a?.riskLevel ? RISK_STYLES[a.riskLevel] : null;

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

          {/* Chips: tags + sentiment + risk + temperature + flags count */}
          {a && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {a.tags?.map((t) => (
                <Badge key={t} variant="secondary" className="text-xs uppercase tracking-wide">
                  {t}
                </Badge>
              ))}
              {sentiment && (
                <Badge variant="outline" className="text-xs">
                  <span className="mr-1">{sentiment.emoji}</span>
                  {sentiment.label}
                </Badge>
              )}
              {a.riskLevel && riskLevelClass && (
                <Badge variant="outline" className={`text-xs ${riskLevelClass}`}>
                  Risco {a.riskLevel}
                </Badge>
              )}
              {a.leadTemperature && (
                <Badge variant="outline" className="text-xs">
                  {TEMPERATURE_LABELS[a.leadTemperature] ?? a.leadTemperature}
                </Badge>
              )}
              {a.proceduralFlags.length > 0 && (
                <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                  {a.proceduralFlags.length}{" "}
                  {a.proceduralFlags.length === 1 ? "desvio" : "desvios"}
                </Badge>
              )}
              {a.followUp && (
                <Badge variant="outline" className="text-xs">
                  → follow-up
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      {a ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Left column: narrative + Ringover summary + recordings */}
          <div className="space-y-4">
            {a.ringoverSummary && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Resumo Ringover
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                    {a.ringoverSummary}
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Narrativa
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                  {a.narrative}
                </p>
              </CardContent>
            </Card>

            {a.positivePoints && a.positivePoints.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Pontos Positivos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {a.positivePoints.map((p, i) => (
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
              <div className="flex flex-wrap gap-2">
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
            {a.proceduralFlags.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Desvios de Procedimento
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {a.proceduralFlags.map((f, i) => {
                      const sev = SEVERITY_STYLES[f.severity as Severity] ?? SEVERITY_STYLES.media;
                      return (
                        <li key={i} className="flex items-start gap-3">
                          <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${sev.dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border ${sev.pill}`}>
                                {sev.label}
                              </span>
                              <span className="text-sm font-medium">{f.label}</span>
                            </div>
                            {f.detail && (
                              <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                                {f.detail}
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

            {a.supervisorFeedback && (
              <Card className="border-blue-200 bg-blue-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-blue-700 flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Feedback Supervisor
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                    {a.supervisorFeedback}
                  </p>
                </CardContent>
              </Card>
            )}

            {a.specialistSuggestions && (
              <Card className="border-cyan-200 bg-cyan-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-cyan-700 flex items-center gap-2">
                    <Stethoscope className="h-3.5 w-3.5" />
                    Sugestão do Especialista
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                    {a.specialistSuggestions}
                  </p>
                </CardContent>
              </Card>
            )}

            {a.followUp && (
              <Card className="border-purple-200 bg-purple-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wide text-purple-700 flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5" />
                    Follow-up Necessário
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-sm text-foreground/80 leading-relaxed">{a.followUp.action}</p>
                  {a.followUp.deadline && (
                    <p className="text-xs text-purple-700 font-medium">
                      Prazo: {a.followUp.deadline}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {a.riskAssessment && (
              <div className="rounded-md border border-red-200 bg-red-50/50 p-3">
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">
                  Avaliação de Risco
                </p>
                <p className="text-sm text-red-900 leading-relaxed">{a.riskAssessment}</p>
              </div>
            )}
          </div>

          {/* Call IDs footer */}
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
