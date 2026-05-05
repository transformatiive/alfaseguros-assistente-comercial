import { Link } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  Phone,
  ArrowRight,
  Star,
  AlertTriangle,
  Sparkles,
  Ticket,
} from "lucide-react";
import { useDateContext } from "@/lib/date-context";
import {
  useListConversations,
  getListConversationsQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useExchangeRate, formatEur } from "@/lib/use-exchange-rate";

const RISK_PILL: Record<string, string> = {
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

export default function Conversas() {
  const { dateStr, selectedDate } = useDateContext();
  const { data: fxData } = useExchangeRate();
  const eurRate = fxData?.rate ?? null;
  const { data: conversations, isLoading } = useListConversations(dateStr, {
    query: { enabled: !!dateStr, queryKey: getListConversationsQueryKey(dateStr) },
  });

  const formattedDate = format(selectedDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Conversas</h1>
          <p className="text-muted-foreground text-sm capitalize">{formattedDate}</p>
        </div>
        {conversations && (
          <Badge variant="outline" className="ml-auto text-xs">
            {conversations.length} {conversations.length === 1 ? "conversa" : "conversas"}
          </Badge>
        )}
      </div>

      {isLoading ? (
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
                          {c.callCount}× legs
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
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 gap-1"
                        >
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
                      {c.deskTicketCount > 0 && (
                        <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200 gap-1">
                          <Ticket className="h-3 w-3" />
                          Desk {c.deskTicketCount > 1 ? `×${c.deskTicketCount}` : ""}
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
                    {c.costUsd != null && c.costUsd > 0 && (
                      <div className="font-mono tabular-nums">{formatEur(c.costUsd, eurRate)}</div>
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
    </div>
  );
}
