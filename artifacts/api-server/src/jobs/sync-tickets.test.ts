import { describe, expect, it } from "vitest";
import { releituraPedida } from "./sync-tickets.js";

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
