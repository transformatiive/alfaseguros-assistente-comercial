import { z } from "zod";

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export interface ZohoAuthOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Default `https://accounts.zoho.com` (US) per HANDOVER §1. */
  accountsBaseUrl?: string;
  fetch?: typeof fetch;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

/** Refresh roughly 60s before the actual expiry so concurrent requests don't race. */
const SAFETY_LEAD_MS = 60_000;

/**
 * OAuth refresh-token cache for Zoho Desk Self-Client. Concurrent callers
 * share a single in-flight refresh promise so we don't burn requests.
 */
export class ZohoAuth {
  private readonly opts: Required<Omit<ZohoAuthOptions, "fetch">> & { fetch: typeof fetch };
  private cache: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  constructor(opts: ZohoAuthOptions) {
    if (!opts.clientId) throw new Error("ZohoAuth: clientId is required");
    if (!opts.clientSecret) throw new Error("ZohoAuth: clientSecret is required");
    if (!opts.refreshToken) throw new Error("ZohoAuth: refreshToken is required");
    this.opts = {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      refreshToken: opts.refreshToken,
      accountsBaseUrl: opts.accountsBaseUrl ?? "https://accounts.zoho.com",
      fetch: opts.fetch ?? globalThis.fetch,
    };
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAtMs > now + SAFETY_LEAD_MS) {
      return this.cache.token;
    }
    if (this.inflight) return this.inflight;
    this.inflight = this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<string> {
    const url = new URL(`${this.opts.accountsBaseUrl}/oauth/v2/token`);
    url.searchParams.set("refresh_token", this.opts.refreshToken);
    url.searchParams.set("client_id", this.opts.clientId);
    url.searchParams.set("client_secret", this.opts.clientSecret);
    url.searchParams.set("grant_type", "refresh_token");

    const res = await this.opts.fetch(url.toString(), { method: "POST" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zoho token refresh failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as unknown;
    const parsed = tokenResponseSchema.parse(json);
    this.cache = {
      token: parsed.access_token,
      expiresAtMs: Date.now() + parsed.expires_in * 1000,
    };
    return parsed.access_token;
  }

  /** Force the next call to refresh (used after a 401). */
  invalidate(): void {
    this.cache = null;
  }
}
