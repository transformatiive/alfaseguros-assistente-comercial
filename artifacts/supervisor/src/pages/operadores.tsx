import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "wouter";
import { User, TrendingUp, Eye, Star, Lightbulb, ArrowUpRight } from "lucide-react";
import { useDateContext } from "@/lib/date-context";
import { useListOperatorSummaries, getListOperatorSummariesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { RichText } from "@/components/rich-text";

export default function Operadores() {
  const { dateStr, selectedDate } = useDateContext();
  const { data: operators, isLoading } = useListOperatorSummaries(dateStr, {
    query: { enabled: !!dateStr, queryKey: getListOperatorSummariesQueryKey(dateStr) },
  });

  const formattedDate = format(selectedDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operadores</h1>
        <p className="text-muted-foreground text-sm capitalize">{formattedDate}</p>
      </div>

      {isLoading ? (
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
                <CardTitle className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-base">{op.operatorName}</p>
                      <p className="text-xs text-muted-foreground font-normal">ID: {op.operatorId}</p>
                    </div>
                  </div>

                  {/* Conversation links */}
                  {op.conversationIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mr-0.5">
                        Conversas:
                      </span>
                      {op.conversationIds.map((id) => (
                        <Link key={id} href={`/conversas/${id}`}>
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] cursor-pointer hover:bg-muted transition-colors gap-1"
                          >
                            #{id}
                            <ArrowUpRight className="h-2.5 w-2.5" />
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {op.paragraphOverview && (
                  <div className="rounded-md bg-stone-900 text-stone-50 p-4">
                    <p
                      className="text-sm leading-relaxed italic"
                      style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
                    >
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
                  {/* Strengths */}
                  {op.strengths.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Star className="h-3.5 w-3.5 text-emerald-500" />
                        <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Pontos Fortes</p>
                      </div>
                      <ul className="space-y-3">
                        {op.strengths.map((s, i) => (
                          <li key={i} className="text-sm text-foreground/80 flex items-start gap-2 leading-relaxed">
                            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                            <RichText text={s} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Blind spots */}
                  {op.blindSpots.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Eye className="h-3.5 w-3.5 text-amber-500" />
                        <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Pontos Cegos</p>
                      </div>
                      <ul className="space-y-3">
                        {op.blindSpots.map((b, i) => (
                          <li key={i} className="text-sm text-foreground/80 flex items-start gap-2 leading-relaxed">
                            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                            <RichText text={b} />
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
                    <ul className="space-y-3">
                      {op.coachingRecommendations.map((r, i) => (
                        <li key={i} className="text-sm text-foreground/80 flex items-start gap-2 leading-relaxed">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                          <RichText text={r} />
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
    </div>
  );
}
