/**
 * Guião da campanha Vida, tal como a Soraia o enviou no PDF "Itens a
 * Validar_Análise Chamadas" (20/10/2026): 4 tipos de chamada, cada um com
 * secções e pontos a validar.
 *
 * As chaves (`id`) são estáveis: ficam gravadas em
 * `chamadas_sftp_resultados.item`. Mudar o texto de um ponto é seguro; mudar a
 * chave separa o histórico.
 */

export type TipoChamada = "primeiro" | "seguinte" | "proposta" | "pos_venda";

export interface PontoGuiao {
  id: string;
  validacao: string;
  pergunta: string;
}

export interface SeccaoGuiao {
  nome: string;
  /** Só se aplica quando algo aconteceu na chamada (ex.: uma objeção). */
  condicao?: string;
  pontos: PontoGuiao[];
}

export interface TipoGuiao {
  id: TipoChamada;
  nome: string;
  /** Como o modelo reconhece este tipo de chamada. */
  descricao: string;
  seccoes: SeccaoGuiao[];
}

function p(id: string, validacao: string, pergunta: string): PontoGuiao {
  return { id, validacao, pergunta };
}

export const GUIAO: TipoGuiao[] = [
  {
    id: "primeiro",
    nome: "1.º Telefonema",
    descricao:
      "Primeiro contacto com o cliente: apresentação, recolha de dados e simulação do seguro de vida do crédito habitação.",
    seccoes: [
      {
        nome: "Apresentação e enquadramento",
        pontos: [
          p("primeiro.apresentacao", "Apresentei-me?", "Disse o meu nome e o da empresa?"),
          p("primeiro.gravacao", "Gravação", "Pedi autorização para gravar a chamada?"),
          p("primeiro.ajuda", "Ajuda", "Disse que ligo para ajudar o cliente a trocar o seguro?"),
          p("primeiro.enquadramento", "Enquadramento", "Sei o banco e o seguro que o cliente tem?"),
        ],
      },
      {
        nome: "Processo de simulação",
        pontos: [
          p("primeiro.dados", "Dados", "Sei as datas de nascimento, o capital em dívida e as profissões?"),
          p("primeiro.preco", "Preço", "Informei o preço mensal e os preços das outras companhias, sem descontos?"),
          p("primeiro.preco_desconto", "Preço com desconto", "Informei o preço com desconto e o prazo do desconto?"),
          p("primeiro.poupanca_anual", "Poupança anual", "Informei a poupança anual em valor ou em meses?"),
          p("primeiro.gostou", "Gostou? Vamos avançar?", "Perguntei se o cliente gostou da simulação?"),
          p(
            "primeiro.proposta",
            "Preenchi a proposta?",
            "Se o cliente disse que sim, avancei para a proposta, mesmo sem todos os dados?",
          ),
          p(
            "primeiro.agendamento",
            "Agendamento de contacto",
            "Se o cliente não quis avançar, marquei data para novo contacto?",
          ),
        ],
      },
      {
        nome: "Argumentação para proposta",
        pontos: [
          p(
            "primeiro.poupanca_global",
            "Poupança global",
            "Perguntei os anos em falta do empréstimo e dei a poupança global?",
          ),
          p("primeiro.reforco_poupanca", "Reforço da poupança", "Reforcei a poupança global em valor ou em anos?"),
        ],
      },
      {
        nome: "Argumentação para objeções",
        condicao: "o cliente levantou dúvidas ou objeções para não avançar",
        pontos: [
          p("primeiro.porque", "Porquê?", "Sei as dúvidas que impedem o cliente de avançar?"),
          p("primeiro.esclarecido", "Esclarecemos o cliente?", "Se sim, preenchemos a proposta?"),
          p("primeiro.quais_duvidas", "Quais as dúvidas?", "Se não, tentámos perceber as dúvidas?"),
        ],
      },
      {
        nome: "Coberturas",
        pontos: [
          p(
            "primeiro.coberturas",
            "Falei das coberturas?",
            "Expliquei IAD, ITP60 e ITP55 e recomendei a melhoria de cobertura?",
          ),
        ],
      },
    ],
  },
  {
    id: "seguinte",
    nome: "Telefonemas seguintes",
    descricao:
      "Contacto de seguimento depois de a simulação ter sido enviada por email: saber se o cliente avança e tratar objeções.",
    seccoes: [
      {
        nome: "Argumentação para proposta",
        pontos: [
          p("seguinte.nome", "Tratei o cliente pelo nome?", "Disse o nome do cliente na chamada?"),
          p(
            "seguinte.gostou",
            "Gostou? Vamos avançar?",
            "Perguntei se gostou dos preços enviados por email e se avançamos?",
          ),
          p("seguinte.poupanca_global", "Poupança global", "Reforcei a poupança global para combater objeções?"),
          p("seguinte.proposta", "Preenchi a proposta?", "Avancei para a proposta, mesmo sem todos os dados?"),
        ],
      },
      {
        nome: "Objeção: ainda não viu o email",
        condicao: "o cliente disse que ainda não viu o email com a simulação",
        pontos: [
          p("seguinte.email.preco_desconto", "Preço com desconto", "Informei o preço com desconto e o prazo do desconto?"),
          p("seguinte.email.poupanca_global", "Poupança global", "Reforcei a poupança global?"),
          p("seguinte.email.coberturas", "Coberturas", "Valorizei a melhoria de cobertura?"),
          p("seguinte.email.avancar", "Vamos avançar?", "Perguntei se avançamos com a proposta?"),
          p("seguinte.email.proposta", "Preenchi a proposta?", "Se disse que sim, avancei para a proposta?"),
        ],
      },
      {
        nome: "Objeção: banco",
        condicao: "o cliente levantou dúvidas por causa do banco (spread, obrigação de ter o seguro no banco)",
        pontos: [
          p("seguinte.banco.duvidas", "Dúvidas?", "Percebi a dúvida concreta do cliente em relação ao banco?"),
          p("seguinte.banco.trocar", "Trocar seguro?", "Informei os direitos legais para trocar o seguro?"),
          p(
            "seguinte.banco.spread",
            "Agravamento do spread?",
            "Pedi o Documento Complementar e esclareci que, na maioria dos casos, compensa mudar?",
          ),
          p(
            "seguinte.banco.poupanca_global",
            "Poupança global",
            "Reforcei a poupança global para valer a pena procurar o Documento Complementar?",
          ),
        ],
      },
      {
        nome: "Objeção: falta de tempo",
        condicao: "o cliente disse que não tem tempo",
        pontos: [
          p("seguinte.tempo.poupanca_global", "Poupança global", "Reforcei que vale a pena tirar 15 minutos para a proposta?"),
          p("seguinte.tempo.proposta", "Preenchi a proposta?", "Avancei para a proposta, mesmo sem todos os dados?"),
        ],
      },
    ],
  },
  {
    id: "proposta",
    nome: "Telefonemas proposta",
    descricao:
      "Chamada para preencher a proposta com o cliente: dados, RGPD, questionário clínico, assinatura, condições particulares.",
    seccoes: [
      {
        nome: "Preenchimento da proposta",
        pontos: [
          p("proposta.nome", "Tratei o cliente pelo nome?", "Disse o nome do cliente na chamada?"),
          p(
            "proposta.procedimento",
            "Expliquei o procedimento?",
            "Expliquei o preenchimento, a assinatura e o questionário clínico?",
          ),
          p("proposta.rgpd", "RGPD", "Tratei da assinatura do RGPD?"),
          p(
            "proposta.questionario",
            "Questionário clínico",
            "Agi de forma honesta, sem informações falsas nem omissões clínicas?",
          ),
        ],
      },
      {
        nome: "Dificuldades no preenchimento",
        condicao: "houve dificuldades no preenchimento (dados em falta, IBAN, tempo, dados clínicos, assinatura)",
        pontos: [
          p("proposta.dados_falta", "Não sabe todos os dados", "Disse que ia enviar um email com os dados necessários?"),
          p("proposta.iban", "IBAN", "Se não quis dar o IBAN por telefone, expliquei que pode enviar por email?"),
          p("proposta.disponibilidade", "Falta de disponibilidade", "Marquei nova data e hora e enviei email com os dados?"),
          p("proposta.dados_clinicos", "Dados clínicos", "Expliquei a importância de declarar todas as questões clínicas?"),
          p(
            "proposta.assinatura",
            "Assinatura digital",
            "Dei apoio ou apresentei a alternativa de assinatura manual?",
          ),
        ],
      },
      {
        nome: "Condições de aceitação",
        condicao: "o cliente tem questões clínicas (pré-existências, agravamentos ou exclusões)",
        pontos: [
          p(
            "proposta.aceitacao",
            "Condições de aceitação",
            "Perguntei se já tinha as questões clínicas quando fez o seguro do banco?",
          ),
          p("proposta.preexistencias", "Pré-existências clínicas", "Perguntei se as declarou na proposta do banco?"),
          p("proposta.agravamento", "Agravamento e/ou exclusões", "Perguntei se no banco também teve agravamento ou exclusões?"),
          p("proposta.nulidade", "Nulidade do seguro do banco", "Informei da nulidade do seguro do banco e dos riscos?"),
        ],
      },
      {
        nome: "Envio das Condições Particulares",
        condicao: "a proposta ficou concluída e há Condições Particulares para entregar ao banco",
        pontos: [
          p("proposta.cp", "Condições Particulares", "Enviei as Condições Particulares para entregar no banco?"),
          p(
            "proposta.debito",
            "Cancelamento do débito direto",
            "Informei que tem de cancelar o débito direto do seguro do banco?",
          ),
        ],
      },
    ],
  },
  {
    id: "pos_venda",
    nome: "Pós-venda",
    descricao:
      "Contacto depois da venda: seguro de vida previdência, avaliação Google, referências de amigos e outros seguros.",
    seccoes: [
      {
        nome: "Seguro de Vida Previdência",
        pontos: [
          p("pos_venda.simulacao", "Simulação", "Apresentei uma simulação de seguro de vida previdência?"),
          p("pos_venda.doencas_graves", "Doenças graves", "Expliquei as vantagens da cobertura de doenças graves?"),
        ],
      },
      {
        nome: "Avaliações Google",
        pontos: [
          p("pos_venda.google", "Avaliação Google", "Pedi uma avaliação e expliquei o procedimento?"),
          p("pos_venda.google_nome", "Comentário com o meu nome", "Pedi que o comentário indique o meu nome?"),
        ],
      },
      {
        nome: "Referenciação",
        pontos: [
          p("pos_venda.contactos", "Pedir contactos", "Pedi contactos de pessoas com crédito habitação?"),
          p("pos_venda.beneficios", "Benefícios", "Expliquei que os conhecidos também podem poupar?"),
          p("pos_venda.oferta", "Oferta", "Expliquei a oferta por cada cliente referenciado?"),
        ],
      },
      {
        nome: "Outros seguros",
        pontos: [
          p("pos_venda.outros", "Outros seguros", "Perguntei se tem outros seguros para rever ou de interesse?"),
          p(
            "pos_venda.colegas",
            "Passagem para os colegas",
            "Informei que passo o contacto ao departamento especializado?",
          ),
        ],
      },
    ],
  },
];

export const TIPOS: TipoChamada[] = GUIAO.map((t) => t.id);

export function tipoGuiao(id: TipoChamada): TipoGuiao {
  const t = GUIAO.find((x) => x.id === id);
  if (!t) throw new Error(`Tipo de chamada desconhecido: ${id}`);
  return t;
}

/** Todos os pontos de um tipo, pela ordem do guião. */
export function pontosDoTipo(id: TipoChamada): PontoGuiao[] {
  return tipoGuiao(id).seccoes.flatMap((s) => s.pontos);
}

/** Ponto + secção + tipo, para mostrar fora do contexto do tipo. */
export interface PontoComContexto extends PontoGuiao {
  tipo: TipoChamada;
  seccao: string;
}

export const PONTOS: Map<string, PontoComContexto> = new Map(
  GUIAO.flatMap((t) =>
    t.seccoes.flatMap((s) => s.pontos.map((pt) => [pt.id, { ...pt, tipo: t.id, seccao: s.nome }] as const)),
  ),
);

/** Abaixo desta confiança o ponto vai para "A rever" e não entra na %. */
export const LIMIAR_CONFIANCA = 0.7;
