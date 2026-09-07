import { describe, expect, it } from "vitest";
import { derivarPrazo, lerPrazoEscrito, prazoInferido } from "./prazos.js";
import { toLisbonDate } from "../lib/dates.js";

/** 4 September 2026 is a Friday. Every "referência" below is that day. */
const SEXTA = new Date("2026-09-04T11:00:00Z");

/** Lisbon wall-clock rendering, so an assertion reads like the promise did. */
function lisboa(d: Date | null): string | null {
  if (!d) return null;
  const hora = d.toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Lisbon",
  });
  return `${toLisbonDate(d)} ${hora}`;
}

describe("lerPrazoEscrito — as frases que o modelo escreve mesmo", () => {
  it("lê 'até ao final do dia 03/09'", () => {
    expect(
      lisboa(
        lerPrazoEscrito(
          "Confirmar até ao final do dia 03/09 se o Carlos enviou os dados da Médis.",
          SEXTA,
        ),
      ),
    ).toBe("2026-09-03 18:00");
  });

  it("fica-se pela PRIMEIRA data: a segunda é o plano B, não o prazo", () => {
    expect(
      lisboa(
        lerPrazoEscrito(
          "Confirmar até ao final do dia 03/09 se o Carlos enviou os dados; caso não chegue, contactar novamente até 04/09 para relembrar.",
          SEXTA,
        ),
      ),
    ).toBe("2026-09-03 18:00");
  });

  it("lê um dia da semana, e 'de manhã' encurta-o", () => {
    expect(
      lisboa(lerPrazoEscrito("Contactar a cliente até segunda-feira de manhã.", SEXTA)),
    ).toBe("2026-09-07 12:00");
    expect(lisboa(lerPrazoEscrito("Ligar até segunda-feira.", SEXTA))).toBe("2026-09-07 18:00");
  });

  it("nunca lê o dia da semana como sendo hoje", () => {
    // Dito numa sexta, "até sexta" é a sexta seguinte — não daqui a zero dias.
    expect(lisboa(lerPrazoEscrito("Responder até sexta-feira.", SEXTA))).toBe("2026-09-11 18:00");
  });

  it("lê uma hora do próprio dia", () => {
    expect(
      lisboa(
        lerPrazoEscrito(
          "Confirmar até às 21h de Lisboa do próprio dia que a documentação foi enviada.",
          SEXTA,
        ),
      ),
    ).toBe("2026-09-04 21:00");
  });

  it("lê o final da semana, e o da próxima", () => {
    expect(
      lisboa(lerPrazoEscrito("Confirmar até ao final da semana se o Joaquim enviou.", SEXTA)),
    ).toBe("2026-09-04 18:00");
    expect(
      lisboa(lerPrazoEscrito("Se não houver resposta até ao final da próxima semana.", SEXTA)),
    ).toBe("2026-09-11 18:00");
  });

  it("num intervalo, fica com o fim — é esse o prazo que o cliente ouviu", () => {
    // 4 set (sexta) + 10 dias úteis = 18 set.
    expect(
      lisboa(lerPrazoEscrito("Agendar um contacto dentro de 7 a 10 dias úteis.", SEXTA)),
    ).toBe("2026-09-18 18:00");
    // E em dias de calendário, 4 + 3 = 7 set.
    expect(lisboa(lerPrazoEscrito("Ligar dentro de 2 a 3 dias.", SEXTA))).toBe("2026-09-07 18:00");
  });

  it("lê 'nos primeiros dias da semana seguinte'", () => {
    expect(
      lisboa(
        lerPrazoEscrito(
          "Agendar um novo contacto nos primeiros dias da semana seguinte.",
          SEXTA,
        ),
      ),
    ).toBe("2026-09-07 18:00");
  });

  it("lê 'no prazo de 5 dias úteis'", () => {
    expect(lisboa(lerPrazoEscrito("Responder no prazo de 5 dias úteis.", SEXTA))).toBe(
      "2026-09-11 18:00",
    );
  });

  it("lê 'ainda no mesmo dia'", () => {
    expect(
      lisboa(lerPrazoEscrito("Enviar o email prometido ainda no mesmo dia.", SEXTA)),
    ).toBe("2026-09-04 18:00");
  });

  it("não inventa datas a partir de números soltos", () => {
    // A matrícula e o número de apólice são os falsos positivos óbvios.
    expect(lerPrazoEscrito("Apólice: 756090957 (Fidelidade) - Matricula 33-OI-45", SEXTA)).toBeNull();
    expect(lerPrazoEscrito("Confirmar o valor de 12/15 escalões do plafond.", SEXTA)).toBeNull();
    expect(lerPrazoEscrito("", SEXTA)).toBeNull();
    expect(lerPrazoEscrito(null, SEXTA)).toBeNull();
  });

  it("passa o ano quando a promessa atravessa a viragem", () => {
    const dezembro = new Date("2026-12-28T11:00:00Z");
    expect(lisboa(lerPrazoEscrito("Confirmar até 03/01.", dezembro))).toBe("2027-01-03 18:00");
  });
});

describe("prazoInferido", () => {
  it("dá dias úteis a uma primeira resposta e dias de calendário a uma espera", () => {
    // Sexta + 1 dia útil = segunda.
    expect(lisboa(prazoInferido("primeira_resposta", SEXTA).quando)).toBe("2026-09-07 18:00");
    // Sexta + 14 dias de calendário.
    expect(lisboa(prazoInferido("espera_cliente", SEXTA).quando)).toBe("2026-09-18 18:00");
  });
});

describe("derivarPrazo — e a razão que o cartão imprime", () => {
  const agora = new Date("2026-09-07T09:00:00Z");

  it("uma data escrita ganha sempre à inferência", () => {
    const p = derivarPrazo({
      texto: "Contactar a cliente até segunda-feira de manhã, conforme prometido.",
      referencia: SEXTA,
      desde: SEXTA,
      tipo: "espera_cliente",
      agora,
    });
    expect(p.origem).toBe("prometido");
    expect(lisboa(new Date(p.quando))).toBe("2026-09-07 12:00");
    expect(p.porque).toBe("prometido na conversa de 04/09");
  });

  it("sem data escrita, infere e diz a regra que usou", () => {
    const p = derivarPrazo({
      texto: "Agendar um novo contacto comercial.",
      referencia: SEXTA,
      desde: SEXTA,
      tipo: "simulacao_pedida",
      agora,
    });
    expect(p.origem).toBe("inferido");
    expect(p.porque).toBe("simulação pedida — 2 dias úteis");
  });

  it("depois de vencido, a razão passa a ser o tempo parado", () => {
    const desde = new Date("2026-08-25T09:00:00Z");
    const p = derivarPrazo({
      texto: null,
      referencia: desde,
      desde,
      tipo: "follow_up_simulacao",
      agora,
    });
    expect(p.origem).toBe("inferido");
    expect(p.porque).toBe("13 dias sem resposta");
  });
});
