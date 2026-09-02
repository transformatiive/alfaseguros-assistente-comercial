import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAS_DE_TICKETS } from "./painel-refresh.js";

/**
 * The refresh runs twice every working day. An LLM call in this path would
 * quietly multiply the analysis budget, and it would not be obvious from the
 * outside — the panel would simply look the same while the bill grew.
 *
 * This is asserted over the **import graph** rather than by mocking a client.
 * A mock only proves that the one path the test exercised stayed quiet; the
 * import graph proves the code *cannot* reach OpenRouter at all, on any path,
 * including ones added later by someone who never read this file.
 */

const aqui = dirname(fileURLToPath(import.meta.url));

/** Resolve a relative import specifier to a real file on disk. */
function resolverFicheiro(base: string, especificador: string): string | null {
  const semExt = resolve(dirname(base), especificador.replace(/\.js$/, ""));
  for (const cand of [`${semExt}.ts`, `${semExt}.tsx`, resolve(semExt, "index.ts")]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/** Every module reachable from `entrada`, plus every bare package it imports. */
function grafoDeImports(entrada: string): { ficheiros: Set<string>; pacotes: Set<string> } {
  const ficheiros = new Set<string>();
  const pacotes = new Set<string>();
  const porVisitar = [entrada];

  while (porVisitar.length > 0) {
    const ficheiro = porVisitar.pop();
    if (!ficheiro || ficheiros.has(ficheiro)) continue;
    ficheiros.add(ficheiro);

    const src = readFileSync(ficheiro, "utf8");
    // Static imports and re-exports. Dynamic import() is matched too, so a
    // lazy `await import("@workspace/openrouter")` cannot slip past.
    const re = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
    for (const m of src.matchAll(re)) {
      const espec = m[1];
      if (espec.startsWith(".")) {
        const alvo = resolverFicheiro(ficheiro, espec);
        if (alvo) porVisitar.push(alvo);
      } else {
        pacotes.add(espec);
      }
    }
  }
  return { ficheiros, pacotes };
}

describe("o refresh do painel não pode chegar ao LLM", () => {
  const { ficheiros, pacotes } = grafoDeImports(resolve(aqui, "painel-refresh.ts"));

  it("walks a real graph — the test itself is not vacuous", () => {
    // Guards against the resolver silently failing and the assertions below
    // passing over an empty set.
    expect(ficheiros.size).toBeGreaterThan(3);
    expect(pacotes.has("@workspace/zoho-desk")).toBe(true);
  });

  it("never imports @workspace/openrouter, directly or transitively", () => {
    const ofensores = [...pacotes].filter((p) => p.includes("openrouter"));
    expect(ofensores).toEqual([]);
  });

  it("never mentions OpenRouter in any reachable module", () => {
    const comMencao = [...ficheiros].filter((f) =>
      /openrouter|OpenRouterClient/i.test(readFileSync(f, "utf8").replace(/OpenRouter\b(?=[^"']*\*\/)/g, "")),
    );
    // A comment explaining the ban is fine; an import or a call is not.
    const comCodigo = comMencao.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /from\s+["'][^"']*openrouter/i.test(src) || /new\s+OpenRouterClient/.test(src);
    });
    expect(comCodigo).toEqual([]);
  });

  /**
   * `analysis/` holds both the LLM prompts and the rule-based classifiers.
   * Banning the whole directory would be banning a folder rather than a
   * behaviour — and it fails today on `outcome.ts`, which is the rule-based
   * outcome classifier (CLAUDE.md: "Outcome classification is rule-based, not
   * AI"). It imports one type and calls nothing.
   *
   * So the allow-list is by module, not by directory: a NEW analysis import
   * appearing in this path fails the test and forces someone to justify it,
   * which is exactly the review this guard exists to trigger.
   */
  const ANALISE_PERMITIDA = ["outcome.ts"];

  it("reaches no analysis module beyond the rule-based classifiers", () => {
    const analise = [...ficheiros]
      .filter((f) => /[/\\]analysis[/\\]/.test(f))
      .map((f) => f.split(/[/\\]/).pop() ?? f)
      .filter((nome) => !ANALISE_PERMITIDA.includes(nome));
    expect(analise).toEqual([]);
  });

  it("the allowed analysis module really is model-free", () => {
    const outcome = [...ficheiros].find((f) => f.endsWith("outcome.ts"));
    expect(outcome).toBeDefined();
    const src = readFileSync(outcome as string, "utf8");
    expect(src).not.toMatch(/openrouter/i);
    expect(src).not.toMatch(/fetch\(/);
  });
});

describe("janela de tickets", () => {
  it("re-syncs two days, enough to cover a weekend gap or a missed run", () => {
    expect(DIAS_DE_TICKETS).toBe(2);
  });
});
