import { z } from "zod";
import {
  nocrmCommentSchema,
  nocrmHistorySchema,
  nocrmLeadSchema,
  nocrmTagSchema,
  nocrmUserSchema,
  type NocrmApiComment,
  type NocrmApiHistory,
  type NocrmApiLead,
  type NocrmApiTag,
  type NocrmApiUser,
} from "./types.js";

/**
 * Cliente de leitura da API v2 do noCRM. Só GET: esta app nunca escreve no
 * noCRM.
 *
 * O noCRM conta 2.000 pedidos por dia por conta e avisa que erros 4XX mal
 * tratados podem levar a chave a ser desligada. Por isso:
 *  - cada pedido gasta uma unidade de um orçamento que quem chama decide;
 *    quando acaba, o cliente pára (`OrcamentoEsgotado`) em vez de continuar;
 *  - um 429 também pára tudo, não se repete.
 */

export class OrcamentoEsgotado extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "OrcamentoEsgotado";
  }
}

export class NocrmErro extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NocrmErro";
  }
}

export interface NocrmClientOptions {
  apiKey: string;
  subdominio: string;
  /** Pedidos que ainda se podem fazer nesta corrida. */
  orcamento: number;
  fetch?: typeof fetch;
}

const PAGINA = 100;

export class NocrmClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private restantes: number;
  private usados = 0;

  constructor(private readonly opts: NocrmClientOptions) {
    this.base = `https://${opts.subdominio}.nocrm.io/api/v2`;
    this.fetchFn = opts.fetch ?? fetch;
    this.restantes = opts.orcamento;
  }

  /** Pedidos feitos por este cliente até agora. */
  get pedidosUsados(): number {
    return this.usados;
  }

  get pedidosRestantes(): number {
    return this.restantes;
  }

  private async get<T>(caminho: string, schema: z.ZodType<T>): Promise<{ dados: T; total: number | null }> {
    if (this.restantes <= 0) {
      throw new OrcamentoEsgotado("Orçamento diário de pedidos ao noCRM esgotado");
    }
    this.restantes -= 1;
    this.usados += 1;

    const res = await this.fetchFn(`${this.base}${caminho}`, {
      headers: { "X-API-KEY": this.opts.apiKey, Accept: "application/json" },
    });
    if (res.status === 429) {
      this.restantes = 0;
      const espera = res.headers.get("api-retry-after");
      throw new OrcamentoEsgotado(`noCRM respondeu 429 (limite diário). Tentar de novo dentro de ${espera ?? "?"} s`);
    }
    if (!res.ok) {
      throw new NocrmErro(`noCRM ${caminho.split("?")[0]} respondeu HTTP ${res.status}`, res.status);
    }
    const json: unknown = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new NocrmErro(`Resposta inesperada do noCRM em ${caminho.split("?")[0]}: ${parsed.error.message}`, 200);
    }
    const totalTxt = res.headers.get("x-total-count");
    return { dados: parsed.data, total: totalTxt ? Number(totalTxt) : null };
  }

  async listarUsers(): Promise<NocrmApiUser[]> {
    return (await this.get("/users", z.array(nocrmUserSchema))).dados;
  }

  async listarTags(): Promise<NocrmApiTag[]> {
    return (await this.get("/predefined_tags", z.array(nocrmTagSchema))).dados;
  }

  /**
   * Uma página de leads. `atualizadasDesde` filtra por `updated_after`; `estado`
   * por `status`. Ordenadas pela última alteração, das mais antigas para as
   * mais recentes, para que um corte a meio deixe o cursor num sítio certo.
   */
  async listarLeads(params: {
    atualizadasDesde?: string;
    estado?: string;
    offset?: number;
  }): Promise<{ leads: NocrmApiLead[]; total: number | null }> {
    const q = new URLSearchParams({
      limit: String(PAGINA),
      offset: String(params.offset ?? 0),
      order: "last_update",
      direction: "asc",
    });
    if (params.atualizadasDesde) q.set("updated_after", params.atualizadasDesde);
    if (params.estado) q.set("status", params.estado);
    const { dados, total } = await this.get(`/leads?${q.toString()}`, z.array(nocrmLeadSchema));
    return { leads: dados, total };
  }

  async listarNotas(leadId: number): Promise<NocrmApiComment[]> {
    return (await this.get(`/leads/${leadId}/comments`, z.array(nocrmCommentSchema))).dados;
  }

  async listarHistorico(leadId: number): Promise<NocrmApiHistory[]> {
    return (await this.get(`/leads/${leadId}/action_histories?limit=100`, z.array(nocrmHistorySchema))).dados;
  }
}

export const NOCRM_PAGINA = PAGINA;
