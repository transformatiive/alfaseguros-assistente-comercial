import React, { useState, useMemo } from "react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon, RefreshCw, Loader2, TrendingUp, MessageSquare,
  Euro, Phone, ArrowRight, Star, AlertTriangle, Sparkles,
  User, Eye, Lightbulb, BookOpen, Bell, PhoneCall, ShieldAlert,
  ChevronDown, ChevronRight, TrendingDown, Sparkles as SparklesIcon,
  FileQuestion, Flame,
} from "lucide-react";
import { useExchangeRate, formatEur } from "@/lib/use-exchange-rate";
import { Link } from "wouter";
import { useDateContext } from "@/lib/date-context";
import Metodologia from "@/pages/metodologia";
import { useRunProgress } from "@/lib/use-run-progress";
import {
  useGetDailySummary,
  useGetRunStatus,
  useListConversations,
  useListOperatorSummaries,
  useListActions,
  useTriggerRun,
  getGetDailySummaryQueryKey,
  getGetRunStatusQueryKey,
  getListConversationsQueryKey,
  getListOperatorSummariesQueryKey,
  getListActionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { RichText } from "@/components/rich-text";

/** Convert a raw error message (possibly a JSON Zod blob) into a readable string. */
function friendlyError(msg: string): string {
  if (msg.trim().startsWith("[")) {
    try {
      const issues = JSON.parse(msg) as Array<{ message?: string; path?: unknown[] }>;
      if (Array.isArray(issues) && issues.length > 0) {
        const first = issues[0];
        const path = Array.isArray(first.path) && first.path.length > 0
          ? ` (${first.path.join(".")})`
          : "";
        const extra = issues.length > 1 ? ` e mais ${issues.length - 1} erro(s)` : "";
        return `Erro de validação${path}: ${first.message ?? "tipo inválido"}${extra}`;
      }
    } catch {
      // fall through
    }
  }
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

const summarySections = [
  {
    key: "workingWell" as const,
    icon: "✓",
    label: "O que está a funcionar bem",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
  },
  {
    key: "toImprove" as const,
    icon: "⚠",
    label: "O que pode ser melhorado",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
  },
  {
    key: "risks" as const,
    icon: "🚨",
    label: "Riscos identificados",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
  },
  {
    key: "closingRateRecommendations" as const,
    icon: "🎯",
    label: "Recomendações para fechar mais",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-200",
  },
];

const FEASIBILITY_STYLES: Record<string, string> = {
  alta: "bg-emerald-100 text-emerald-700 border-emerald-200",
  media: "bg-amber-100 text-amber-700 border-amber-200",
  baixa: "bg-stone-100 text-stone-700 border-stone-200",
};

const RISK_PILL: Record<string, string> = {
  baixo: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medio: "bg-amber-50 text-amber-700 border-amber-200",
  alto: "bg-red-50 text-red-700 border-red-200",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pendente", variant: "secondary" },
    running: { label: "A analisar...", variant: "default" },
    completed: { label: "Concluído", variant: "default" },
    failed: { label: "Erro", variant: "destructive" },
  };
  const config = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3 w-3 ${n <= value ? "fill-amber-400 text-amber-400" : "text-stone-300"}`}
        />
      ))}
    </span>
  );
}

export default function Dashboard() {
  const { selectedDate, setSelectedDate, dateStr } = useDateContext();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("resumo");

  const { data: run, isLoading: runLoading } = useGetRunStatus(dateStr, {
    query: { enabled: !!dateStr, queryKey: getGetRunStatusQueryKey(dateStr) },
  });

  const { data: summary, isLoading: summaryLoading } = useGetDailySummary(dateStr, {
    query: { enabled: !!dateStr, queryKey: getGetDailySummaryQueryKey(dateStr) },
  });

  const { data: conversations, isLoading: convsLoading } = useListConversations(dateStr, {
    query: { enabled: !!dateStr, queryKey: getListConversationsQueryKey(dateStr) },
  });

  const { data: operators, isLoading: opsLoading } = useListOperatorSummaries(dateStr, {
    query: { enabled: !!dateStr, queryKey: getListOperatorSummariesQueryKey(dateStr) },
  });

  const { data: actions } = useListActions(dateStr, {
    query: { enabled: !!dateStr, queryKey: getListActionsQueryKey(dateStr) },
  });

  useRunProgress(run?.status === "running" || run?.status === "pending" ? dateStr : null);

  const { data: fxData } = useExchangeRate();
  const eurRate = fxData?.rate ?? null;
  const fxDate = fxData?.rateDate ?? null;

  const trigger = useTriggerRun({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRunStatusQueryKey(dateStr) });
        queryClient.invalidateQueries({ queryKey: getGetDailySummaryQueryKey(dateStr) });
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey(dateStr) });
        queryClient.invalidateQueries({ queryKey: getListOperatorSummariesQueryKey(dateStr) });
      },
    },
  });

  const quickDates = [
    { label: "Ontem", date: subDays(new Date(), 1) },
    { label: "Há 2 dias", date: subDays(new Date(), 2) },
    { label: "Há uma semana", date: subDays(new Date(), 7) },
  ];

  const formattedDate = format(selectedDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Supervisor Virtual</h1>
          <p className="text-muted-foreground text-sm mt-1 capitalize">{formattedDate}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {quickDates.map(({ label, date }) => (
            <Button
              key={label}
              variant="outline"
              size="sm"
              onClick={() => setSelectedDate(date)}
              className={cn(
                "text-xs",
                format(date, "yyyy-MM-dd") === dateStr && "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {label}
            </Button>
          ))}

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" />
                Escolher data
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Run status card */}
      <Card className="border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Estado da Análise</CardTitle>
            {run && <StatusBadge status={run.status} />}
          </div>
        </CardHeader>
        <CardContent>
          {runLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ) : run ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <MessageSquare className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Conversas</p>
                  <p className="font-semibold text-sm">
                    {run.analyzedConversations ?? 0} / {run.totalConversations ?? 0}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Progresso</p>
                  <p className="font-semibold text-sm">
                    {run.totalConversations
                      ? Math.round(((run.analyzedConversations ?? 0) / run.totalConversations) * 100)
                      : 0}%
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <Euro className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Custo total
                    {fxDate && (
                      <span className="ml-1 opacity-50" title={`Taxa EUR/USD de ${fxDate}`}>({fxDate})</span>
                    )}
                  </p>
                  <p className="font-semibold text-sm">
                    {run.totalCostUsd != null ? formatEur(run.totalCostUsd, eurRate) : "—"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma análise encontrada para esta data.</p>
          )}

          <div className="mt-4 pt-4 border-t flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                disabled={trigger.isPending || run?.status === "running"}
                onClick={() => trigger.mutate({ data: { date: dateStr } })}
                className="gap-2"
              >
                {trigger.isPending || run?.status === "running" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Analisar este dia
              </Button>
            </div>
            {run?.errorMessage && (
              <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2 leading-relaxed">
                {friendlyError(run.errorMessage)}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats strip */}
      {conversations && conversations.length > 0 && <StatsStrip conversations={conversations} />}

      {/* Tabs: Resumo | Conversas | Operadores */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="resumo">Resumo Executivo</TabsTrigger>
          <TabsTrigger value="conversas">
            Conversas
            {conversations && conversations.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                {conversations.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="operadores">
            Operadores
            {operators && operators.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                {operators.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="acoes" className="gap-1.5">
            <Bell className="h-3.5 w-3.5" />
            Ações do Dia
            {actions && actions.filter(a => a.prioridade !== "baixa").length > 0 && (
              <span className="ml-1.5 rounded-full bg-destructive text-destructive-foreground px-1.5 py-0.5 text-[10px] font-mono">
                {actions.filter(a => a.prioridade !== "baixa").length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="guia" className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            Legenda Processos
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Resumo Executivo ── */}
        <TabsContent value="resumo">
          {summaryLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          ) : summary ? (
            <div className="space-y-4">
              {summary.executiveSummary && (
                <div className="rounded-lg bg-stone-900 text-stone-50 p-5">
                  <p
                    className="text-base leading-relaxed italic"
                    style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
                  >
                    <RichText text={summary.executiveSummary} />
                  </p>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-2">
                {summarySections.map((section) => {
                  const sec = summary[section.key];
                  if (!sec || (!sec.paragraph && sec.bullets.length === 0)) return null;
                  return (
                    <div key={section.key} className={cn("rounded-lg border p-4", section.bg)}>
                      <div className={cn("flex items-center gap-2 mb-2 font-semibold text-sm uppercase tracking-wide", section.color)}>
                        <span className="text-base">{section.icon}</span>
                        {section.label}
                      </div>
                      {sec.bullets.length > 0 && (
                        <ul className="space-y-1 mb-2">
                          {sec.bullets.map((b, i) => (
                            <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-current flex-shrink-0 opacity-60" />
                              <RichText text={b} />
                            </li>
                          ))}
                        </ul>
                      )}
                      {sec.paragraph && (
                        <p className="text-sm text-foreground/60 leading-relaxed italic border-t border-current/10 pt-2"><RichText text={sec.paragraph} /></p>
                      )}
                    </div>
                  );
                })}
              </div>

              {summary.automationOpportunities &&
                (summary.automationOpportunities.paragraph || summary.automationOpportunities.items.length > 0) && (
                  <div className="rounded-lg border bg-violet-50 border-violet-200 p-4">
                    <div className="flex items-center gap-2 mb-2 font-semibold text-sm uppercase tracking-wide text-violet-700">
                      <span className="text-base">🤖</span>
                      Oportunidades de Automação
                    </div>
                    {summary.automationOpportunities.paragraph && (
                      <p className="text-sm text-foreground/80 leading-relaxed mb-3">
                        {summary.automationOpportunities.paragraph}
                      </p>
                    )}
                    <div className="grid gap-2 md:grid-cols-2">
                      {summary.automationOpportunities.items.map((item, i) => (
                        <div key={i} className="rounded-md bg-white border border-violet-200 p-3">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <p className="text-sm font-medium text-foreground">{item.pattern}</p>
                            <Badge variant="outline" className={cn("text-[10px]", FEASIBILITY_STYLES[item.feasibility] ?? "")}>
                              {item.feasibility}
                            </Badge>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            {item.channel && <span>{item.channel}</span>}
                            {item.conversationCountEstimate > 0 && (
                              <>
                                <span>·</span>
                                <span>~{item.conversationCountEstimate} conversas</span>
                              </>
                            )}
                          </div>
                          {item.notes && (
                            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{item.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum resumo disponível para esta data. Clique em "Analisar este dia" para gerar a análise.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── TAB 2: Conversas ── */}
        <TabsContent value="conversas">
          {convsLoading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : conversations && conversations.length > 0 ? (
            <div className="space-y-2">
              {conversations.map((c) => {
                const riscoClass = c.riscoPerdaLead ? RISK_PILL[c.riscoPerdaLead] : null;
                const duration = formatDuration(c.durationSec);
                return (
                  <Link
                    key={c.id}
                    href={`/conversas/${c.id}`}
                    className={cn(
                      "block rounded-md border bg-card hover:bg-muted/40 transition-colors px-4 py-3",
                      c.isMultiLeg && "border-l-[3px] border-l-blue-700",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Phone className="h-3.5 w-3.5 text-stone-600" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-sm">{c.customerPhone}</span>
                          {c.agentName && (
                            <>
                              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-sm">{c.agentName}</span>
                            </>
                          )}
                          {c.isMultiLeg && (
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {c.callCount}× interações
                            </Badge>
                          )}
                          {duration && (
                            <span className="text-xs text-muted-foreground font-mono">{duration}</span>
                          )}
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {c.produto && (
                            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                              {c.produto}
                            </Badge>
                          )}
                          {c.categoria && (
                            <Badge variant="outline" className="text-[10px]">
                              {c.categoria}
                            </Badge>
                          )}
                          {c.qualidadeGlobal != null && <Stars value={c.qualidadeGlobal} />}
                          {c.desviosCount > 0 && (
                            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {c.desviosCount} {c.desviosCount === 1 ? "desvio" : "desvios"}
                            </Badge>
                          )}
                          {c.riscoPerdaLead && riscoClass && (
                            <Badge variant="outline" className={`text-[10px] ${riscoClass}`}>
                              Risco {c.riscoPerdaLead}
                            </Badge>
                          )}
                          {c.followUpNecessario && (
                            <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 gap-1">
                              <Sparkles className="h-3 w-3" />
                              follow-up
                            </Badge>
                          )}
                          {!c.hasAnalysis && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              análise pendente
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground text-right flex-shrink-0">
                        {format(new Date(c.startTime ?? c.createdAt), "HH:mm")}
                        {c.costUsd != null && (
                          <div className="font-mono">{formatEur(c.costUsd, eurRate)}</div>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma conversa encontrada para esta data.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── TAB 3: Operadores ── */}
        <TabsContent value="operadores">
          {opsLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-48 w-full rounded-lg" />
              ))}
            </div>
          ) : operators && operators.length > 0 ? (
            <div className="space-y-4">
              {operators.map((op) => (
                <Card key={op.id} className="border">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-base">{op.operatorName}</p>
                        <p className="text-xs text-muted-foreground font-normal">ID: {op.operatorId}</p>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {op.paragraphOverview && (
                      <div className="rounded-md bg-stone-900 text-stone-50 p-4">
                        <p className="text-sm leading-relaxed italic" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
                          <RichText text={op.paragraphOverview} />
                        </p>
                      </div>
                    )}

                    {op.closingRateObservations && (
                      <div className="flex items-start gap-2.5 p-3 rounded-md bg-blue-50 border border-blue-200">
                        <TrendingUp className="h-4 w-4 text-blue-700 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-foreground/80 leading-relaxed"><RichText text={op.closingRateObservations} /></p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {op.strengths.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <Star className="h-3.5 w-3.5 text-emerald-500" />
                            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Pontos Fortes</p>
                          </div>
                          <ul className="space-y-1">
                            {op.strengths.map((s, i) => (
                              <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {op.blindSpots.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <Eye className="h-3.5 w-3.5 text-amber-500" />
                            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Pontos Cegos</p>
                          </div>
                          <ul className="space-y-1">
                            {op.blindSpots.map((b, i) => (
                              <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                                {b}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {op.coachingRecommendations.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <Lightbulb className="h-3.5 w-3.5 text-blue-500" />
                          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Recomendações de Coaching</p>
                        </div>
                        <ul className="space-y-1">
                          {op.coachingRecommendations.map((r, i) => (
                            <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum resumo de operador disponível para esta data.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── TAB 5: Ações do Dia ── */}
        <TabsContent value="acoes">
          <AcoesTab actions={actions ?? []} />
        </TabsContent>

        {/* ── TAB 6: Guia de Leitura ── */}
        <TabsContent value="guia">
          <Metodologia />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Ações do Dia component ─────────────────────────────────────────────────

type ActionTipo =
  | "follow_up_pendente"
  | "risco_perda_lead"
  | "desvio_procedimento"
  | "qualidade_critica"
  | "oportunidade_cross_sell"
  | "cotacao_sem_seguimento"
  | "lead_quente_sem_fecho";

type ActionItem = {
  id: string;
  tipo: ActionTipo;
  prioridade: "alta" | "media" | "baixa";
  titulo: string;
  descricao: string;
  conversationId: number;
  agentName: string | null;
  customerPhone: string;
  contactName: string | null;
  runDate: string;
};

const TIPO_ORDER: ActionTipo[] = [
  "follow_up_pendente",
  "risco_perda_lead",
  "lead_quente_sem_fecho",
  "cotacao_sem_seguimento",
  "desvio_procedimento",
  "qualidade_critica",
  "oportunidade_cross_sell",
];

const TIPO_CONFIG: Record<ActionTipo, {
  label: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  iconColor: string;
}> = {
  follow_up_pendente: {
    label: "Follow-up pendente",
    icon: PhoneCall,
    color: "text-sky-700",
    bg: "bg-sky-50 border-sky-200",
    iconColor: "text-sky-500",
  },
  risco_perda_lead: {
    label: "Risco de perda de lead",
    icon: AlertTriangle,
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
    iconColor: "text-red-500",
  },
  desvio_procedimento: {
    label: "Desvio de procedimento",
    icon: ShieldAlert,
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
    iconColor: "text-amber-500",
  },
  qualidade_critica: {
    label: "Qualidade crítica",
    icon: TrendingDown,
    color: "text-rose-700",
    bg: "bg-rose-50 border-rose-200",
    iconColor: "text-rose-500",
  },
  oportunidade_cross_sell: {
    label: "Oportunidade de cross-sell",
    icon: SparklesIcon,
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
    iconColor: "text-emerald-500",
  },
  cotacao_sem_seguimento: {
    label: "Cotação sem seguimento",
    icon: FileQuestion,
    color: "text-violet-700",
    bg: "bg-violet-50 border-violet-200",
    iconColor: "text-violet-500",
  },
  lead_quente_sem_fecho: {
    label: "Lead quente sem fecho",
    icon: Flame,
    color: "text-orange-700",
    bg: "bg-orange-50 border-orange-200",
    iconColor: "text-orange-500",
  },
};

const PRIORIDADE_PILL: Record<string, string> = {
  alta: "bg-red-100 text-red-700 border border-red-200",
  media: "bg-amber-100 text-amber-700 border border-amber-200",
  baixa: "bg-stone-100 text-stone-600 border border-stone-200",
};

const PRIORIDADE_LABEL: Record<string, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};


function ActionCard({ item }: { item: ActionItem }) {
  const cfg = TIPO_CONFIG[item.tipo];
  const Icon = cfg.icon;
  return (
    <div className={cn("rounded-lg border p-4 flex items-start gap-3", cfg.bg)}>
      <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", cfg.iconColor)} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn("text-[10px] rounded-full px-1.5 py-0.5 font-medium border", PRIORIDADE_PILL[item.prioridade])}
          >
            {PRIORIDADE_LABEL[item.prioridade]}
          </span>
          {item.contactName ? (
            <span className="text-[10px] font-medium text-foreground">{item.contactName}</span>
          ) : null}
          <span className="text-[10px] text-muted-foreground font-mono">{item.customerPhone}</span>
        </div>
        <p className="text-sm font-medium leading-snug">{item.titulo}</p>
        {item.descricao && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            <RichText text={item.descricao} />
          </p>
        )}
      </div>
      <Link
        href={`/conversas/${item.conversationId}`}
        className="text-xs text-primary hover:underline flex-shrink-0 mt-0.5 whitespace-nowrap"
      >
        Ver conversa →
      </Link>
    </div>
  );
}

function AcoesTab({ actions }: { actions: ActionItem[] }) {
  const byAgent = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const item of actions) {
      const key = item.agentName ?? "Sem operador";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [actions]);

  const agentKeys = useMemo(
    () => [...byAgent.keys()].sort((a, b) => a.localeCompare(b, "pt")),
    [byAgent],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allCollapsed = collapsed.size === agentKeys.length && agentKeys.length > 0;

  const toggleAll = () => {
    setCollapsed(allCollapsed ? new Set() : new Set(agentKeys));
  };

  const toggleAgent = (agent: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const altaCount = actions.filter((a) => a.prioridade === "alta").length;
  const mediaCount = actions.filter((a) => a.prioridade === "media").length;

  if (actions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <Bell className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Nenhuma ação pendente para esta data.</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          As ações aparecem quando existe follow-up necessário, risco de lead, desvios de procedimento ou qualidade crítica.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <Bell className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-medium">{actions.length} ações · {agentKeys.length} operadores</span>
        {altaCount > 0 && (
          <span className="text-xs rounded-full bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 font-medium">
            {altaCount} alta
          </span>
        )}
        {mediaCount > 0 && (
          <span className="text-xs rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 font-medium">
            {mediaCount} média
          </span>
        )}
        <button
          onClick={toggleAll}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          {allCollapsed ? (
            <><ChevronDown className="h-3.5 w-3.5" /> Expandir todos</>
          ) : (
            <><ChevronRight className="h-3.5 w-3.5 rotate-90" /> Recolher todos</>
          )}
        </button>
      </div>

      {/* Per-agent sections */}
      {agentKeys.map((agent) => {
        const items = byAgent.get(agent)!;
        const isCollapsed = collapsed.has(agent);

        // Sub-group by tipo
        const byTipo = new Map<ActionTipo, ActionItem[]>();
        for (const item of items) {
          const list = byTipo.get(item.tipo) ?? [];
          list.push(item);
          byTipo.set(item.tipo, list);
        }
        const presentTipos = TIPO_ORDER.filter((t) => byTipo.has(t));

        return (
          <div key={agent} className="rounded-lg border bg-card">
            {/* Agent header */}
            <button
              onClick={() => toggleAgent(agent)}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-lg"
            >
              {isCollapsed
                ? <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              }
              <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-semibold flex-1">{agent}</span>
              <span className="text-xs text-muted-foreground">{items.length} ações</span>
              {/* Type summary pills */}
              <div className="hidden sm:flex items-center gap-1 ml-2">
                {presentTipos.map((t) => {
                  const cfg = TIPO_CONFIG[t];
                  return (
                    <span key={t} className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium border", cfg.bg, cfg.color)}>
                      {cfg.label} ({byTipo.get(t)!.length})
                    </span>
                  );
                })}
              </div>
            </button>

            {/* Agent body */}
            {!isCollapsed && (
              <div className="px-4 pb-4 space-y-5 border-t pt-4">
                {presentTipos.map((tipo) => {
                  const tipoItems = byTipo.get(tipo)!;
                  const cfg = TIPO_CONFIG[tipo];
                  const Icon = cfg.icon;
                  return (
                    <div key={tipo}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Icon className={cn("h-3.5 w-3.5", cfg.iconColor)} />
                        <p className={cn("text-xs font-semibold uppercase tracking-wide", cfg.color)}>
                          {cfg.label} <span className="text-muted-foreground font-normal normal-case tracking-normal">({tipoItems.length})</span>
                        </p>
                      </div>
                      <div className="space-y-2">
                        {tipoItems.map((item) => (
                          <ActionCard key={item.id} item={item} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface StatsStripConv {
  callCount: number;
  isMultiLeg: boolean;
  qualidadeGlobal: number | null;
  desviosCount: number;
  followUpNecessario: boolean;
  riscoPerdaLead: string | null;
}

function StatsStrip({ conversations }: { conversations: StatsStripConv[] }) {
  const total = conversations.length;
  const multiLeg = conversations.filter((c) => c.isMultiLeg).length;
  const qualities = conversations.map((c) => c.qualidadeGlobal).filter((q): q is number => q != null);
  const avgQuality = qualities.length > 0 ? qualities.reduce((a, b) => a + b, 0) / qualities.length : null;
  const desviosTotal = conversations.reduce((acc, c) => acc + c.desviosCount, 0);
  const followUps = conversations.filter((c) => c.followUpNecessario).length;
  const atRisk = conversations.filter((c) => c.riscoPerdaLead === "alto").length;

  const stats = [
    {
      label: "Conversas",
      value: total.toString(),
      alert: false,
      hint: "Total de conversas (grupos de chamadas com o mesmo contacto) registadas no dia.",
    },
    {
      label: "Multi-chamada",
      value: multiLeg.toString(),
      alert: false,
      hint: "Conversas com mais do que uma chamada para o mesmo contacto no mesmo dia. Pode indicar necessidade de resolução não satisfeita na primeira chamada.",
    },
    {
      label: "Qualidade Média",
      value: avgQuality != null ? avgQuality.toFixed(1) : "—",
      alert: avgQuality != null && avgQuality < 3,
      hint: "Média da qualidade global (1 a 5) de todas as conversas analisadas. Avalia abertura, qualificação, apresentação, gestão de objeções e fecho. Valores abaixo de 3 são assinalados a vermelho.",
    },
    {
      label: "Desvios",
      value: desviosTotal.toString(),
      alert: desviosTotal > 0,
      hint: "Total de desvios ao processo interno detetados em todas as conversas do dia (alta + média + baixa severidade). Ver detalhe em cada conversa.",
    },
    {
      label: "Follow-ups",
      value: followUps.toString(),
      alert: false,
      hint: "Conversas com uma ação de seguimento pendente (por efetuar) — por exemplo, ligar ao cliente numa data combinada ou enviar simulação por email.",
    },
    {
      label: "Em Risco",
      value: atRisk.toString(),
      alert: atRisk > 0,
      hint: "Conversas classificadas com risco alto de perda de lead — o cliente pode não avançar sem intervenção urgente do supervisor ou do operador.",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-md border bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {s.label}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px]">
                <p className="text-xs font-semibold mb-1">{s.label}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{s.hint}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p
            className={cn("mt-1 text-3xl tabular-nums leading-none", s.alert ? "text-red-600" : "text-foreground")}
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}
