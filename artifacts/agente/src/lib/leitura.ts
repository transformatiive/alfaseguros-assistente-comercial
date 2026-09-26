/**
 * As regras de leitura do painel — o que cada tarefa diz ao agente, e como.
 *
 * Funções puras, sem React, para poderem ser testadas e para que o protótipo
 * aprovado (faixa do dia, coluna de prazos, "sai da lista com…") tenha uma
 * única fonte para as frases que mostra.
 */
import type { BaldeDePrazo, CategoriaTarefa, Coaching, Tarefa, TarefasPorPrazo } from "./tipos";

/**
 * Como é que uma tarefa sai da lista, dito ao agente.
 *
 * É a regra da prova (`api-server/src/painel/evidencia.ts`) escrita do lado de
 * quem trabalha. Antes o painel só dizia o que *faltava* — "sem resposta tua no
 * ticket" —, o que soa a acusação e não diz o que fazer. Dizer como sai diz as
 * duas coisas.
 *
 * `null` para "à espera do cliente": essas nunca saem sozinhas.
 */
export function comoSai(categoria: CategoriaTarefa): string | null {
  switch (categoria) {
    case "devolver_chamada":
      return "uma chamada atendida para este número";
    case "enviar_simulacao":
    case "espera_alfa":
      return "uma resposta tua no ticket";
    case "cumprir_compromisso":
    case "retomar_conversa":
      return "uma chamada atendida ou uma resposta tua";
    case "espera_cliente":
      return null;
  }
}

/** O que a tarefa é, numa linha pequena por cima do título. */
export const TIPO_DE_TAREFA: Record<CategoriaTarefa, string> = {
  devolver_chamada: "Chamada por devolver",
  enviar_simulacao: "Simulação por enviar",
  cumprir_compromisso: "Prometido numa chamada",
  espera_alfa: "Pedido no Desk à espera de nós",
  retomar_conversa: "Conversa por retomar",
  espera_cliente: "À espera do cliente",
};

const LISBOA = "Europe/Lisbon";

/**
 * O que vai na coluna de prazos, à esquerda de cada tarefa.
 *
 * Duas linhas: a grande responde "quando?", a pequena diz de que tipo de
 * quando se trata. Atrasada conta o atraso (é isso que pesa); hoje dá a hora;
 * esta semana dá o dia.
 */
export function colunaDoPrazo(
  prazo: string,
  balde: Exclude<BaldeDePrazo, "aguardar">,
  agora: Date,
): { grande: string; pequeno: string } {
  const d = new Date(prazo);
  if (balde === "atrasado") {
    const horas = Math.max(1, Math.round((agora.getTime() - d.getTime()) / 3_600_000));
    if (horas < 48) return { grande: `${horas} h`, pequeno: "de atraso" };
    return { grande: `${Math.floor(horas / 24)} dias`, pequeno: "de atraso" };
  }
  if (balde === "hoje") {
    return {
      grande: d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: LISBOA }),
      pequeno: "hoje",
    };
  }
  const semana = d
    .toLocaleDateString("pt-PT", { weekday: "short", timeZone: LISBOA })
    .replace(/\.$/, "")
    .slice(0, 3);
  const dia = d.toLocaleDateString("pt-PT", { day: "numeric", timeZone: LISBOA });
  const mes = d.toLocaleDateString("pt-PT", { month: "long", timeZone: LISBOA });
  return { grande: `${semana} ${dia}`, pequeno: mes };
}

/**
 * A tarefa que abre o dia: a mais atrasada, ou, sem atrasadas, a primeira de
 * hoje. `null` quando não há nenhuma das duas — "esta semana" não merece o
 * destaque de "começa por aqui".
 */
export function primeiraTarefa(p: TarefasPorPrazo): { tarefa: Tarefa; balde: "atrasado" | "hoje" } | null {
  if (p.atrasado.length > 0) return { tarefa: p.atrasado[0], balde: "atrasado" };
  if (p.hoje.length > 0) return { tarefa: p.hoje[0], balde: "hoje" };
  return null;
}

/**
 * A frase do topo. Diz só o que decide o dia: quantas atrasadas, quantas para
 * hoje. Os números sozinhos, lado a lado, obrigavam a ler três rótulos para
 * chegar à mesma conclusão.
 */
export function resumoDoDia(atrasado: number, hoje: number): string {
  const a = atrasado === 1 ? "1 tarefa atrasada" : `${atrasado} tarefas atrasadas`;
  const h = hoje === 1 ? "1 para hoje" : `${hoje} para hoje`;
  if (atrasado === 0 && hoje === 0) return "Nada atrasado nem para hoje.";
  if (atrasado === 0) return `Tens ${h}.`;
  if (hoje === 0) return `Tens ${a}.`;
  return `Tens ${a} e ${h}.`;
}

/**
 * A leitura de ontem em três frases: o que correu bem, o que pode ser melhor,
 * o foco de hoje. A primeira de cada lista, que é a que a análise pôs à
 * frente. O resto continua a um clique.
 */
export function leituraCurta(c: Coaching): {
  bem: string | null;
  melhor: string | null;
  foco: string | null;
} {
  return {
    bem: c.strengths[0] ?? null,
    melhor: c.blindSpots[0] ?? null,
    foco: c.coachingRecommendations[0] ?? null,
  };
}

/** Tira o negrito em markdown que a análise escreve (`**assim**`). */
export function semMarcas(texto: string): string {
  return texto.replace(/\*\*([^*]+)\*\*/g, "$1");
}

const CORES_DE_CLIENTE = ["#2F6FB0", "#0E7C86", "#6B4FA0", "#8A5A2B", "#A23B5E", "#B7791F", "#3C7A3E", "#5A6B78"];

/**
 * A cor das iniciais de um cliente. Sempre a mesma para o mesmo nome, para
 * que a mesma pessoa se reconheça de um dia para o outro sem ler.
 */
export function corDoCliente(chave: string): string {
  let h = 0;
  for (const ch of chave) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return CORES_DE_CLIENTE[h % CORES_DE_CLIENTE.length];
}

/**
 * Onde cai uma hora do dia na faixa das 08h às 20h, de 0 a 100. `null` fora
 * dela — um prazo às 22h não tem onde ser desenhado, e esticar a faixa por
 * causa dele encolheria o dia de trabalho.
 */
export function posicaoNaFaixa(iso: string): number | null {
  const partes = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: LISBOA,
  }).formatToParts(new Date(iso));
  const h = Number(partes.find((p) => p.type === "hour")?.value);
  const m = Number(partes.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const x = ((h + m / 60 - 8) / 12) * 100;
  return x < 0 || x > 100 ? null : x;
}
