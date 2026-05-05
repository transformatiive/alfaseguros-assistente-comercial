import { BookOpen, Star, AlertTriangle, Sparkles, ShieldAlert, TrendingUp, ClipboardList, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

function MetricCard({ icon, iconBg, title, subtitle, children }: MetricCardProps) {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-start gap-4">
        <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0", iconBg)}>
          {icon}
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-3 text-sm text-foreground/80 leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-semibold text-foreground text-xs uppercase tracking-wider mb-1.5">{title}</p>
      {children}
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", color)}>
      {label}
    </span>
  );
}

export default function Metodologia() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Guia de Leitura</h1>
        </div>
        <p className="text-muted-foreground leading-relaxed max-w-2xl">
          O Supervisor Virtual analisa automaticamente cada conversa telefónica com base nos procedimentos internos da equipa Não Vida / 360. Esta página explica o que cada indicador significa e como deve ser interpretado.
        </p>
      </div>

      {/* How it works */}
      <div className="rounded-lg border bg-stone-900 text-stone-100 p-5 space-y-3">
        <div className="flex items-center gap-2 text-stone-300 text-xs font-semibold uppercase tracking-wider">
          <Info className="h-3.5 w-3.5" />
          Como funciona a análise
        </div>
        <p className="text-sm leading-relaxed">
          Após cada dia, o sistema vai buscar ao Ringover todas as chamadas entre os operadores e os clientes/leads, agrupa-as por contacto (uma conversa pode ter múltiplas chamadas), e envia cada conversa ao modelo de linguagem Claude (Anthropic) com o <strong className="text-stone-100">processo de referência interno da Alfaseguros</strong> como contexto. O modelo é instruído a avaliar a conversa contra esse processo e a produzir uma análise estruturada em Português europeu.
        </p>
        <p className="text-sm leading-relaxed text-stone-300">
          Os resultados são gerados por inteligência artificial e devem ser interpretados como um ponto de partida para reflexão — não como avaliações definitivas. O supervisor mantém sempre o julgamento final.
        </p>
      </div>

      {/* Metrics grid */}
      <div className="grid gap-5 lg:grid-cols-2">

        {/* Qualidade */}
        <MetricCard
          icon={<Star className="h-5 w-5 text-amber-600" />}
          iconBg="bg-amber-100"
          title="Qualidade Média / Estrelas"
          subtitle="Escala de 1 a 5 — avaliação global da conversa"
        >
          <Section title="O que mede">
            <p>
              A qualidade global da conversa, avaliada pelo modelo numa escala inteira de 1 a 5. Agrega vários aspetos: abertura da chamada, qualificação do cliente, apresentação da proposta, gestão de objeções, fecho e combinação de próximo passo.
            </p>
          </Section>
          <Section title="Referência">
            <div className="space-y-1">
              {[
                { v: "5 ★★★★★", label: "Excelente — todos os pontos do processo cumpridos, cliente bem encaminhado" },
                { v: "4 ★★★★", label: "Bom — pequenas lacunas que não afetam o resultado" },
                { v: "3 ★★★", label: "Suficiente — cumprimento parcial; há melhorias claras a fazer" },
                { v: "2 ★★", label: "Fraco — desvios significativos que podem comprometer o negócio" },
                { v: "1 ★", label: "Má — falhas graves de processo ou atendimento" },
              ].map((r) => (
                <div key={r.v} className="flex items-start gap-2">
                  <span className="font-mono text-xs text-amber-700 w-20 flex-shrink-0">{r.v}</span>
                  <span className="text-xs">{r.label}</span>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Nota">
            <p className="text-xs text-muted-foreground">
              A qualidade média no painel de estatísticas é a média aritmética das conversas que tiveram análise concluída. Conversas sem análise (análise pendente) não entram no cálculo.
            </p>
          </Section>
        </MetricCard>

        {/* Desvios */}
        <MetricCard
          icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
          iconBg="bg-amber-100"
          title="Desvios de Procedimento"
          subtitle="Momentos em que o operador se afastou do processo interno"
        >
          <Section title="O que é um desvio">
            <p>
              Um desvio é qualquer momento em que o operador se afastou dos procedimentos internos da equipa Não Vida / 360. O modelo compara o que aconteceu na chamada com o que o processo define como correto.
            </p>
          </Section>
          <Section title="Exemplos de desvios comuns">
            <ul className="space-y-1 text-xs">
              {[
                "Não confirmar a identidade do cliente no início de uma chamada outbound",
                "Prometer algo dependente da aceitação da seguradora (ex: aceitação imediata)",
                "Terminar a chamada sem combinar um próximo passo com data concreta",
                "Não recolher os dados mínimos para simulação",
                "Gerir objeção de preço baixando imediatamente sem reposicionamento",
              ].map((ex) => (
                <li key={ex} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  {ex}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Severidade">
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5">
                <Pill label="Alta" color="bg-red-50 text-red-700 border-red-200" />
                <span className="text-xs">risco direto de perder negócio ou cliente</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Pill label="Média" color="bg-amber-50 text-amber-700 border-amber-200" />
                <span className="text-xs">lacuna de processo que deve ser corrigida</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Pill label="Baixa" color="bg-stone-100 text-stone-700 border-stone-200" />
                <span className="text-xs">oportunidade de melhoria, impacto menor</span>
              </div>
            </div>
          </Section>
          <Section title="Nota">
            <p className="text-xs text-muted-foreground">
              O contador de desvios no painel mostra o total de desvios detetados em todas as conversas analisadas no dia, independentemente da severidade. O detalhe por severidade está disponível dentro de cada conversa.
            </p>
          </Section>
        </MetricCard>

        {/* Follow-ups */}
        <MetricCard
          icon={<Sparkles className="h-5 w-5 text-blue-600" />}
          iconBg="bg-blue-100"
          title="Follow-ups"
          subtitle="Conversas com ação de seguimento pendente"
        >
          <Section title="O que significa">
            <p>
              Um follow-up é marcado quando a conversa terminou com uma ação de seguimento concreto <strong>por realizar</strong> — não conversas já seguidas. Exemplos: ligar ao cliente numa data acordada, enviar uma simulação por email, confirmar a aceitação pela seguradora.
            </p>
          </Section>
          <Section title="Como é identificado">
            <p>
              O modelo avalia se existe um compromisso concreto que ainda precisa de ser cumprido após a chamada. Se sim, descreve <em>o quê</em> e <em>quando</em> na ficha de cada conversa (campo "Follow-up").
            </p>
          </Section>
          <Section title="Processo de referência">
            <p className="text-xs">
              Segundo o processo interno: o operador deve combinar sempre um próximo passo com <strong>data específica</strong> ("posso ligar-lhe na quinta de manhã para confirmar?") e marcar a tarefa no Zoho Desk. Quando isso acontece mas a ação ainda não foi executada, a conversa entra na contagem de follow-ups.
            </p>
          </Section>
          <Section title="Nota">
            <p className="text-xs text-muted-foreground">
              O número de follow-ups refere-se às conversas do dia analisado — não é um histórico acumulado. Para acompanhar follow-ups abertos ao longo do tempo, use o Zoho Desk.
            </p>
          </Section>
        </MetricCard>

        {/* Em Risco */}
        <MetricCard
          icon={<ShieldAlert className="h-5 w-5 text-red-600" />}
          iconBg="bg-red-100"
          title="Em Risco"
          subtitle="Leads com risco elevado de perda"
        >
          <Section title="O que significa">
            <p>
              Uma conversa é classificada como "em risco" quando o modelo avalia que o lead tem <strong>risco alto de perda</strong> — ou seja, a probabilidade de o cliente não avançar com negócio é elevada se não houver intervenção.
            </p>
          </Section>
          <Section title="Sinais que levam a risco alto">
            <ul className="space-y-1 text-xs">
              {[
                "Cliente prometeu responder mas não há follow-up agendado (lead frio)",
                "Cliente mostrou objeções fortes não resolvidas durante a chamada",
                "Operador não conseguiu apresentar proposta ou alternativa concreta",
                "Múltiplas chamadas pelo mesmo assunto sem resolução (frustração acumulada)",
                "Cliente pediu para não ser contactado ou revelou estar a comparar ativamente com concorrência",
              ].map((s) => (
                <li key={s} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Escala de risco">
            <div className="space-y-1">
              {[
                { pill: { label: "Risco Alto", color: "bg-red-50 text-red-700 border-red-200" }, desc: "intervenção urgente recomendada (entra no contador «Em Risco»)" },
                { pill: { label: "Risco Médio", color: "bg-amber-50 text-amber-700 border-amber-200" }, desc: "atenção reforçada no follow-up" },
                { pill: { label: "Risco Baixo", color: "bg-emerald-50 text-emerald-700 border-emerald-200" }, desc: "conversa saudável, cliente bem encaminhado" },
              ].map((r) => (
                <div key={r.pill.label} className="flex items-center gap-2 flex-wrap">
                  <Pill {...r.pill} />
                  <span className="text-xs">{r.desc}</span>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Nota">
            <p className="text-xs text-muted-foreground">
              O contador no painel mostra apenas conversas com risco <strong>alto</strong>. As de risco médio e baixo estão visíveis na tab Conversas, com o respetivo rótulo colorido.
            </p>
          </Section>
        </MetricCard>

        {/* Multi-chamada */}
        <MetricCard
          icon={<TrendingUp className="h-5 w-5 text-blue-600" />}
          iconBg="bg-blue-100"
          title="Multi-chamada"
          subtitle="Conversas compostas por mais do que uma chamada"
        >
          <Section title="O que significa">
            <p>
              Uma conversa multi-chamada agrupa todas as chamadas entre a Alfaseguros e o mesmo contacto que ocorreram no mesmo dia. Por exemplo: o cliente ligou de manhã, desligou e voltou a ligar à tarde — são duas chamadas, uma conversa.
            </p>
          </Section>
          <Section title="Porquê é relevante">
            <p>
              Quando um cliente liga múltiplas vezes pelo mesmo assunto, pode indicar que a primeira chamada não resolveu a sua necessidade. O modelo avalia a <em>continuidade</em> entre as chamadas — se o operador retomou o contexto ou começou do zero.
            </p>
          </Section>
          <Section title="Identificação visual">
            <p className="text-xs">
              Na lista de conversas, as multi-chamadas têm uma barra azul no lado esquerdo e mostram o número de chamadas (ex: <span className="font-mono bg-muted px-1 rounded text-[11px]">3× legs</span>). O modelo recebe o histórico completo para análise.
            </p>
          </Section>
        </MetricCard>

        {/* Processo interno */}
        <MetricCard
          icon={<ClipboardList className="h-5 w-5 text-violet-600" />}
          iconBg="bg-violet-100"
          title="Processo de Referência Interno"
          subtitle="A base que orienta toda a análise"
        >
          <Section title="Abertura da chamada">
            <ul className="space-y-1 text-xs">
              <li className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-400 flex-shrink-0" /><strong>Inbound:</strong> identificar a Alfaseguros e o operador; perguntar como pode ajudar.</li>
              <li className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-400 flex-shrink-0" /><strong>Outbound:</strong> identificar-se e a Alfaseguros; confirmar identidade do cliente antes de revelar dados; perguntar se é boa altura para falar.</li>
            </ul>
          </Section>
          <Section title="Qualificação">
            <ul className="space-y-1 text-xs">
              {[
                "Confirmar produto pretendido (TVDE, Auto, Multirriscos, Saúde…)",
                "Recolher dados mínimos para simulação (NIF, morada, dados do bem)",
                "TVDE: plataforma, idade, carta, sinistros últimos 5 anos",
                "Multirriscos: tipo de imóvel, regime, área bruta, nº de casas de banho",
              ].map((i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                  {i}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Apresentação e objeções">
            <ul className="space-y-1 text-xs">
              {[
                "Apresentar pelo menos uma seguradora; dar 2 opções se possível",
                "Explicar coberturas principais e exclusões críticas (não ler tudo)",
                "Dar valor anual + opções de fracionamento",
                "Nunca prometer o que depende da seguradora aceitar",
                "Objeção de preço: reposicionar cobertura, não baixar sem motivo",
                "\"Vou pensar\": aceitar mas combinar próximo passo concreto com data",
              ].map((i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                  {i}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Fecho e follow-up">
            <ul className="space-y-1 text-xs">
              {[
                "Combinar próximo passo com data específica (não \"quando tiver disponibilidade\")",
                "Enviar simulação por email logo após a chamada quando possível",
                "Marcar tarefa de follow-up no Zoho Desk",
              ].map((i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                  {i}
                </li>
              ))}
            </ul>
          </Section>
          <div className="rounded-md bg-violet-50 border border-violet-200 p-3 text-xs text-violet-800">
            <strong>Nota:</strong> Este processo é a versão atual carregada no sistema. Quando os procedimentos forem revistos pela equipa, o ficheiro é atualizado e todas as análises seguintes passarão a usar as novas regras. Análises antigas não são retroativamente alteradas.
          </div>
        </MetricCard>
      </div>

      {/* Footer note */}
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Dúvidas sobre a interpretação de um resultado específico? Abra a ficha da conversa para ver o feedback completo gerado para o operador e os desvios identificados com detalhe.
        </p>
      </div>
    </div>
  );
}
