import { useQuery } from "@tanstack/react-query";

interface RateResult {
  /** EUR per 1 USD, e.g. 0.92 */
  rate: number | null;
  /** ISO date string of when the rate was fetched */
  rateDate: string | null;
}

async function fetchEurRate(): Promise<RateResult> {
  const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
  if (!res.ok) throw new Error("Failed to fetch exchange rate");
  const data = (await res.json()) as { rates?: Record<string, number>; date?: string };
  const rate = data.rates?.EUR ?? null;
  return { rate, rateDate: data.date ?? null };
}

/**
 * Returns the current USD→EUR conversion rate fetched from exchangerate-api.com.
 * Cached for 12 hours; falls back gracefully when offline.
 */
export function useExchangeRate() {
  return useQuery<RateResult>({
    queryKey: ["eur-usd-rate"],
    queryFn: fetchEurRate,
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  });
}

/**
 * Format a USD amount as € using the live rate.
 * Falls back to showing the raw USD value when the rate is unavailable.
 */
export function formatEur(usd: number, rate: number | null): string {
  if (rate == null) return `$${usd.toFixed(4)}`;
  const eur = usd * rate;
  if (eur < 0.01) return `${(eur * 100).toFixed(3)} c€`;
  return `${eur.toFixed(4)} €`;
}
