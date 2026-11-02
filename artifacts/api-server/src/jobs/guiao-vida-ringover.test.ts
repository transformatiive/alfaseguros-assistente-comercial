import { describe, expect, it } from "vitest";
import type { RingoverCall } from "@workspace/ringover";
import type { EquipaColaborador } from "../analise-chamadas/agregar.js";
import { chamadasVidaParaRegistar, contarPalavras, idChamadaRingover } from "./guiao-vida-ringover.js";

const roster = new Map<string, EquipaColaborador>([
  ["20", "vida"],
  ["10", "360"],
]);
const nomes = new Map([["20", "Ana Rodrigues"]]);

function call(o: Partial<RingoverCall> & Record<string, unknown>): RingoverCall {
  return {
    cdr_id: 1,
    call_id: "c1",
    direction: "out",
    is_answered: true,
    start_time: "2026-10-20T09:00:00Z",
    incall_duration: 120,
    user: { user_id: 20 },
    from_number: "351210270858",
    to_number: "351911111111",
    record: "https://cdn.ringover.com/records/x.mp3",
    ...o,
  } as RingoverCall;
}

describe("chamadasVidaParaRegistar", () => {
  it("só atendidas da equipa Vida; curtas abaixo de 30 s; uma por call_id", () => {
    const r = chamadasVidaParaRegistar(
      [
        call({}),
        call({ cdr_id: 2 }), // mesma call_id (transferência)
        call({ cdr_id: 3, call_id: "c3", incall_duration: 12 }),
        call({ cdr_id: 4, call_id: "c4", is_answered: false }),
        call({ cdr_id: 5, call_id: "c5", user: { user_id: 10 } }),
      ],
      roster,
      nomes,
    );
    expect(r.map((c) => [c.ficheiro, c.estado])).toEqual([
      ["ringover:c1", "pendente"],
      ["ringover:c3", "curta"],
    ]);
    expect(r[0]).toMatchObject({
      colaborador: "Ana Rodrigues",
      agenteId: "20",
      gravacaoUrl: "https://cdn.ringover.com/records/x.mp3",
      duracaoS: 120,
    });
  });
});

describe("helpers", () => {
  it("idChamadaRingover só para chaves do Ringover", () => {
    expect(idChamadaRingover("ringover:abc")).toBe("abc");
    expect(idChamadaRingover("shared/x.mp3")).toBeNull();
  });
  it("contarPalavras ignora as etiquetas dos locutores", () => {
    expect(contarPalavras("Locutor A: olá bom dia\nLocutor B: sim")).toBe(4);
  });
});
