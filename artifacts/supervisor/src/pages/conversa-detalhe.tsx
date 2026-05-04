import { Link, useParams } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Phone, AlertTriangle, MessageSquare, Stethoscope, ShieldAlert, BookOpen } from "lucide-react";
import { useDateContext } from "@/lib/date-context";
import { useGetConversation, getGetConversationQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ConversaDetalhe() {
  const params = useParams<{ id: string }>();
  const { dateStr } = useDateContext();
  const conversationId = parseInt(params.id ?? "", 10);

  const { data: conv, isLoading } = useGetConversation(dateStr, conversationId, {
    query: { enabled: !!dateStr && !isNaN(conversationId), queryKey: getGetConversationQueryKey(dateStr, conversationId) },
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
        <Link href="/conversas" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">Conversa não encontrada.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Link href="/conversas" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-xl font-bold tracking-tight">{conv.customerPhone}</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            {format(new Date(conv.createdAt), "d 'de' MMMM, HH:mm", { locale: ptBR })}
            {" · "}
            {conv.callIds.length} {conv.callIds.length === 1 ? "chamada" : "chamadas"}
            {conv.costUsd != null && ` · $${conv.costUsd.toFixed(4)}`}
          </p>
        </div>
      </div>

      {conv.analysis ? (
        <div className="space-y-4">
          {/* Narrative */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                Narrativa
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground/80 leading-relaxed">{conv.analysis.narrative}</p>
            </CardContent>
          </Card>

          {/* Procedural flags */}
          {conv.analysis.proceduralFlags.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  Desvios Procedimentais
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {conv.analysis.proceduralFlags.map((flag, i) => (
                    <li key={i} className="text-sm text-amber-800 flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      {flag}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Coaching feedback */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                Coaching
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground/80 leading-relaxed">{conv.analysis.coachingFeedback}</p>
            </CardContent>
          </Card>

          {/* Specialist suggestions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-primary" />
                Sugestões de Especialista
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground/80 leading-relaxed">{conv.analysis.specialistSuggestions}</p>
            </CardContent>
          </Card>

          {/* Risk assessment */}
          <Card className="border-red-200 bg-red-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-red-700">
                <ShieldAlert className="h-4 w-4" />
                Avaliação de Risco e Follow-up
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-red-800 leading-relaxed">{conv.analysis.riskAssessment}</p>
            </CardContent>
          </Card>

          {/* Call IDs */}
          <div className="flex flex-wrap gap-2">
            {conv.callIds.map((id) => (
              <Badge key={id} variant="outline" className="font-mono text-xs">
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
