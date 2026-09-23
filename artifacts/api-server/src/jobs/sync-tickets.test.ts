import { describe, expect, it } from "vitest";
import { releituraPedida, ticketsAReler } from "./sync-tickets.js";

/**
 * O interruptor da releitura.
 *
 * Existe porque a troca de `/comments` para `/conversations` não tem efeito
 * nenhum nos tickets já sincronizados: o salto por `modifiedTime` acha que já
 * sabe tudo sobre eles. Uma correcção que não se aplica ao histórico é meia
 * correcção.
 *
 * Testado porque o preço de o ler mal é assimétrico: ligado por engano, relê
 * o portal de quinze em quinze minutos e queima a quota da Zoho.
 */
describe("releituraPedida", () => {
  it("só liga com o valor exacto", () => {
    expect(releituraPedida({ SYNC_RELER_CONVERSAS: "1" })).toBe(true);
  });

  it("fica desligada por omissão", () => {
    expect(releituraPedida({})).toBe(false);
  });

  it("um valor parecido não chega", () => {
    // "true", "sim" e "yes" são as tentativas óbvias de quem não leu a
    // documentação. Aceitá-las tornaria o engano mais fácil, não mais difícil.
    for (const v of ["true", "sim", "yes", "0", "", " 1"]) {
      expect(releituraPedida({ SYNC_RELER_CONVERSAS: v })).toBe(false);
    }
  });
});

/**
 * A releitura estreita, por número.
 *
 * A larga chegou a pedir 5000 tickets para corrigir três. Esta tem de aceitar
 * a forma como as pessoas escrevem números de tickets, e mais nada.
 */
describe("ticketsAReler", () => {
  it("lê a lista como as pessoas a escrevem", () => {
    expect(ticketsAReler({ SYNC_RELER_TICKETS: "176152,176592" })).toEqual(["176152", "176592"]);
    expect(ticketsAReler({ SYNC_RELER_TICKETS: "#176152, #176592" })).toEqual(["176152", "176592"]);
    expect(ticketsAReler({ SYNC_RELER_TICKETS: "176152 176592;176152" })).toEqual(["176152", "176592"]);
  });

  it("fica vazia por omissão", () => {
    expect(ticketsAReler({})).toEqual([]);
    expect(ticketsAReler({ SYNC_RELER_TICKETS: "" })).toEqual([]);
  });

  it("ignora o que não é um número", () => {
    expect(ticketsAReler({ SYNC_RELER_TICKETS: "1; DROP TABLE, abc, 12a, 176592" })).toEqual(["1", "176592"]);
  });

  it("não passa de 20, para um engano não virar uma releitura grande", () => {
    const muitos = Array.from({ length: 50 }, (_, i) => String(1000 + i)).join(",");
    expect(ticketsAReler({ SYNC_RELER_TICKETS: muitos })).toHaveLength(20);
  });
});
