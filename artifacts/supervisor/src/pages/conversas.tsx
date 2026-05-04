import { Link } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Phone, ChevronRight, CheckCircle2, Clock, ArrowLeft } from "lucide-react";
import { useDateContext } from "@/lib/date-context";
import { useListConversations, getListConversationsQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function Conversas() {
  const { dateStr, selectedDate } = useDateContext();
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
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : conversations && conversations.length > 0 ? (
        <div className="rounded-lg border overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span>Cliente</span>
            <span>Chamadas</span>
            <span>Análise</span>
            <span>Custo</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {conversations.map((conv) => (
              <Link
                key={conv.id}
                href={`/conversas/${conv.id}`}
                className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center px-4 py-3.5 hover:bg-muted/30 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Phone className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{conv.customerPhone}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(conv.createdAt), "HH:mm")}
                    </p>
                  </div>
                </div>

                <Badge variant="outline" className="text-xs hidden sm:inline-flex">
                  {conv.callCount} {conv.callCount === 1 ? "chamada" : "chamadas"}
                </Badge>

                <div className="hidden sm:block">
                  {conv.hasAnalysis ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                <span className="hidden sm:block text-xs text-muted-foreground">
                  {conv.costUsd != null ? `$${conv.costUsd.toFixed(4)}` : "—"}
                </span>

                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </Link>
            ))}
          </div>
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
