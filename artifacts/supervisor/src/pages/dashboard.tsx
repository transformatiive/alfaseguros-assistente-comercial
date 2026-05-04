import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, RefreshCw, CheckCircle2, AlertTriangle, AlertOctagon, Target, Bot, Loader2, TrendingUp, MessageSquare, DollarSign } from "lucide-react";
import { useDateContext } from "@/lib/date-context";
import {
  useGetDailySummary,
  useGetRunStatus,
  useTriggerRun,
  getGetDailySummaryQueryKey,
  getGetRunStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

const summarySection = [
  {
    key: "workingWell" as const,
    icon: "✓",
    label: "O que está a funcionar bem",
    color: "text-emerald-600",
    bg: "bg-emerald-50 border-emerald-200",
  },
  {
    key: "toImprove" as const,
    icon: "⚠",
    label: "O que pode ser melhorado",
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
  },
  {
    key: "risks" as const,
    icon: "🚨",
    label: "Riscos identificados",
    color: "text-red-600",
    bg: "bg-red-50 border-red-200",
  },
  {
    key: "closingRateRecommendations" as const,
    icon: "🎯",
    label: "Recomendações para fechar mais",
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200",
  },
  {
    key: "automationOpportunities" as const,
    icon: "🤖",
    label: "Oportunidades de Automação",
    color: "text-violet-600",
    bg: "bg-violet-50 border-violet-200",
  },
];

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

export default function Dashboard() {
  const { selectedDate, setSelectedDate, dateStr } = useDateContext();
  const queryClient = useQueryClient();

  const { data: run, isLoading: runLoading } = useGetRunStatus(dateStr, {
    query: { enabled: !!dateStr, queryKey: getGetRunStatusQueryKey(dateStr) },
  });

  const { data: summary, isLoading: summaryLoading } = useGetDailySummary(dateStr, {
    query: { enabled: !!dateStr, queryKey: getGetDailySummaryQueryKey(dateStr) },
  });

  const trigger = useTriggerRun({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRunStatusQueryKey(dateStr) });
        queryClient.invalidateQueries({ queryKey: getGetDailySummaryQueryKey(dateStr) });
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
                  <DollarSign className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Custo total</p>
                  <p className="font-semibold text-sm">
                    {run.totalCostUsd != null ? `$${run.totalCostUsd.toFixed(4)}` : "—"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma análise encontrada para esta data.</p>
          )}

          <div className="mt-4 pt-4 border-t flex items-center gap-3">
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
            {run?.errorMessage && (
              <p className="text-xs text-destructive">{run.errorMessage}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Daily summary */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-3">Resumo Executivo</h2>
        {summaryLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : summary ? (
          <div className="space-y-3">
            {summarySection.map((section) => {
              const items = summary[section.key];
              if (!items || items.length === 0) return null;
              return (
                <div
                  key={section.key}
                  className={cn("rounded-lg border p-4", section.bg)}
                >
                  <div className={cn("flex items-center gap-2 mb-2 font-medium text-sm", section.color)}>
                    <span className="text-base">{section.icon}</span>
                    {section.label}
                  </div>
                  <ul className="space-y-1">
                    {items.map((item, i) => (
                      <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-current flex-shrink-0 opacity-60" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum resumo disponível para esta data. Clique em "Analisar este dia" para gerar a análise.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
