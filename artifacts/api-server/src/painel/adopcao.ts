import { somarDias, toLisbonDate } from "../lib/dates.js";

/**
 * Quem está mesmo a usar o painel.
 *
 * Todas as outras vistas medem o trabalho da equipa. Esta mede o nosso: um
 * painel com os números todos certos que ninguém abre não vale nada, e essa é
 * uma falha que não aparece em mais lado nenhum.
 *
 * ## O que conta como uma utilização
 *
 * Não um pedido. O painel volta a pedir dados quando a pessoa regressa ao
 * separador, e o widget renova o token de treze em treze minutos — contar
 * pedidos mediria sobretudo o nosso código a funcionar, e daria à pessoa que
 * deixa o separador aberto em segundo plano um número enorme sem ter olhado
 * para nada.
 *
 * Uma **visita** é um conjunto de pedidos seguidos com menos de trinta minutos
 * entre cada dois. Meia hora porque é aí que fica a fronteira entre "olhei,
 * fui fazer outra coisa e voltei" — uma visita — e "voltei depois do almoço",
 * que é outra. Não há maneira de acertar isto perfeitamente, e não é preciso:
 * a pergunta é quem abre e quem não abre, não quantas vezes exactamente.
 *
 * ## Quem nunca entrou também é resposta — na verdade, é *a* resposta
 *
 * A lista inclui sempre toda a gente com acesso, com zero quando é zero. Uma
 * tabela só com quem apareceu responde à pergunta errada e esconde a única
 * informação accionável: de quem é que ainda ninguém sabe nada.
 */

export type Granularidade = "dia" | "semana" | "mes";

/** Um pedido ao painel, reduzido ao que a contagem precisa. */
export interface Acesso {
  colaboradorId: number;
  /** Instante ISO do pedido. */
  instante: string;
  vista: string;
}

/** Alguém com acesso ao painel — apareça ou não nos acessos. */
export interface PessoaComAcesso {
  id: number;
  nome: string;
  papel: string;
  equipa: string;
}

export interface Periodo {
  /** Chave estável: `2026-09-19`, `2026-W38` ou `2026-09`. */
  chave: string;
  /** Primeiro dia do período, `YYYY-MM-DD`. Serve para ordenar e rotular. */
  inicio: string;
  /** Último dia do período, inclusive. */
  fim: string;
}

export interface LinhaDeAdopcao {
  colaboradorId: number;
  nome: string;
  papel: string;
  equipa: string;
  /** Visitas por período, na mesma ordem de `periodos`. */
  porPeriodo: number[];
  /** Total de visitas na janela inteira. */
  total: number;
  /** Em quantos dias distintos apareceu. */
  diasComUso: number;
  /** Instante ISO da última visita, ou `null` se nunca abriu. */
  ultimaVisita: string | null;
  /** Quais das abas abriu, por ordem de uso. */
  vistas: string[];
}

export interface Adopcao {
  granularidade: Granularidade;
  de: string;
  ate: string;
  periodos: Periodo[];
  linhas: LinhaDeAdopcao[];
  /** Quantas pessoas distintas abriram o painel em cada período. */
  pessoasPorPeriodo: number[];
  /** Quantas visitas houve, ao todo, em cada período. */
  visitasPorPeriodo: number[];
}

/**
 * O intervalo entre dois pedidos a partir do qual começa outra visita.
 *
 * Exportado porque o teste precisa de escrever casos de um lado e do outro da
 * fronteira, e uma constante copiada para o teste deixa de ser a mesma no dia
 * em que uma das duas mudar.
 */
export const INTERVALO_ENTRE_VISITAS_MS = 30 * 60 * 1000;

/** Segunda-feira da semana de `dia`, em `YYYY-MM-DD`. */
export function inicioDaSemana(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay: domingo = 0. Queremos segunda = 0, por isso o +6 e o resto.
  const desdeSegunda = (utc.getUTCDay() + 6) % 7;
  return somarDias(dia, -desdeSegunda);
}

/** Último dia do mês de `dia`, em `YYYY-MM-DD`. */
function fimDoMes(dia: string): string {
  const [y, m] = dia.split("-").map(Number);
  // Dia 0 do mês seguinte é o último do actual, incluindo Fevereiro bissexto.
  const ultimo = new Date(Date.UTC(y, m, 0));
  return ultimo.toISOString().slice(0, 10);
}

/**
 * O período a que um dia pertence.
 *
 * A semana usa a numeração ISO na chave (`2026-W38`) porque é a que toda a
 * gente em Portugal usa quando diz "semana 38", mas o `inicio` continua a ser
 * a data da segunda-feira — é por ela que se ordena e se rotula, e uma chave
 * legível não substitui uma data ordenável.
 */
export function periodoDe(dia: string, granularidade: Granularidade): Periodo {
  if (granularidade === "dia") return { chave: dia, inicio: dia, fim: dia };

  if (granularidade === "mes") {
    const inicio = `${dia.slice(0, 7)}-01`;
    return { chave: dia.slice(0, 7), inicio, fim: fimDoMes(dia) };
  }

  const inicio = inicioDaSemana(dia);
  return { chave: `${semanaIso(inicio)}`, inicio, fim: somarDias(inicio, 6) };
}

/**
 * `2026-W38`, pela regra ISO 8601: a semana 1 é a que contém a primeira
 * quinta-feira do ano.
 *
 * A quinta-feira é o truque todo — é o dia do meio, por isso o ano a que ela
 * pertence é o ano da semana. Sem isso, a semana de 30 de dezembro de 2025
 * apareceria como semana 1 de 2025 em vez de 2026, e as duas colunas de fim de
 * ano trocariam de sítio.
 */
export function semanaIso(inicio: string): string {
  const [y, m, d] = inicio.split("-").map(Number);
  const quinta = new Date(Date.UTC(y, m - 1, d + 3));
  const anoDaSemana = quinta.getUTCFullYear();
  const primeiroDeJaneiro = Date.UTC(anoDaSemana, 0, 1);
  const numero = Math.floor((quinta.getTime() - primeiroDeJaneiro) / 86_400_000 / 7) + 1;
  return `${anoDaSemana}-W${String(numero).padStart(2, "0")}`;
}

/** Todos os períodos entre `de` e `ate`, sem buracos e sem repetições. */
export function periodosEntre(de: string, ate: string, granularidade: Granularidade): Periodo[] {
  const periodos: Periodo[] = [];
  let dia = de;
  // Tecto de segurança: uma janela absurda não pode pendurar o servidor a
  // gerar períodos até ao fim do calendário.
  for (let i = 0; i < 800 && dia <= ate; i++) {
    const p = periodoDe(dia, granularidade);
    if (periodos.at(-1)?.chave !== p.chave) periodos.push(p);
    dia = somarDias(p.fim, 1);
  }
  return periodos;
}

/**
 * Colapsa uma lista de instantes nas visitas que representam.
 *
 * Devolve o instante de abertura de cada visita — não só a contagem — porque a
 * última abertura é o que a tabela mostra na coluna "última vez", e recalculá-la
 * à parte seria a mesma travessia outra vez.
 */
export function visitasDe(instantes: readonly number[]): number[] {
  const ordenados = [...instantes].sort((a, b) => a - b);
  const visitas: number[] = [];
  let anterior: number | null = null;
  for (const t of ordenados) {
    if (anterior === null || t - anterior > INTERVALO_ENTRE_VISITAS_MS) visitas.push(t);
    anterior = t;
  }
  return visitas;
}

/**
 * A tabela inteira, a partir dos acessos crus e de quem tem acesso.
 *
 * `pessoas` manda na lista de linhas, e não os acessos: é por isso que quem
 * nunca abriu aparece. Um acesso de alguém que entretanto perdeu o acesso (ou
 * foi desactivado) é ignorado — a pergunta é sobre quem podia estar a usar
 * isto hoje.
 */
export function derivarAdopcao({
  acessos,
  pessoas,
  de,
  ate,
  granularidade,
}: {
  acessos: readonly Acesso[];
  pessoas: readonly PessoaComAcesso[];
  de: string;
  ate: string;
  granularidade: Granularidade;
}): Adopcao {
  const periodos = periodosEntre(de, ate, granularidade);
  const indiceDoPeriodo = new Map(periodos.map((p, i) => [p.chave, i]));

  const porPessoa = new Map<number, Acesso[]>();
  for (const p of pessoas) porPessoa.set(p.id, []);
  for (const a of acessos) porPessoa.get(a.colaboradorId)?.push(a);

  const pessoasPorPeriodo = periodos.map(() => 0);
  const visitasPorPeriodo = periodos.map(() => 0);

  const linhas = pessoas.map((pessoa) => {
    const seus = porPessoa.get(pessoa.id) ?? [];
    const porPeriodo = periodos.map(() => 0);
    const dias = new Set<string>();
    const vistas: string[] = [];

    for (const a of seus) if (!vistas.includes(a.vista)) vistas.push(a.vista);

    // Agrupado por período *antes* de colapsar: uma visita que atravessasse a
    // fronteira entre dois dias seria contada uma vez em cada, e é isso que se
    // quer — em ambos os dias a pessoa esteve lá.
    const instantesPorPeriodo = new Map<number, number[]>();
    for (const a of seus) {
      const t = Date.parse(a.instante);
      if (!Number.isFinite(t)) continue;
      const dia = toLisbonDate(new Date(t));
      dias.add(dia);
      const i = indiceDoPeriodo.get(periodoDe(dia, granularidade).chave);
      if (i === undefined) continue;
      const lista = instantesPorPeriodo.get(i);
      if (lista) lista.push(t);
      else instantesPorPeriodo.set(i, [t]);
    }

    let total = 0;
    let ultima: number | null = null;
    for (const [i, instantes] of instantesPorPeriodo) {
      const visitas = visitasDe(instantes);
      porPeriodo[i] = visitas.length;
      total += visitas.length;
      visitasPorPeriodo[i] += visitas.length;
      pessoasPorPeriodo[i] += 1;
      const maisTarde = Math.max(...instantes);
      if (ultima === null || maisTarde > ultima) ultima = maisTarde;
    }

    return {
      colaboradorId: pessoa.id,
      nome: pessoa.nome,
      papel: pessoa.papel,
      equipa: pessoa.equipa,
      porPeriodo,
      total,
      diasComUso: dias.size,
      ultimaVisita: ultima === null ? null : new Date(ultima).toISOString(),
      vistas,
    };
  });

  // Quem nunca abriu primeiro. É o oposto de um ranking, e de propósito: a
  // lista existe para encontrar quem não está a usar isto, e enterrar essas
  // linhas no fundo esconderia exactamente o que se veio cá ver.
  linhas.sort((a, b) => a.total - b.total || a.nome.localeCompare(b.nome, "pt"));

  return { granularidade, de, ate, periodos, linhas, pessoasPorPeriodo, visitasPorPeriodo };
}
