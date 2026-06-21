import {
  listCallsResponseSchema,
  ringoverUserSchema,
  type RingoverCall,
  type RingoverUser,
} from "./types.js";

const DEFAULT_BASE_URL = "https://public-api.ringover.com/v2";

/** Maximum batch size accepted by GET /calls (verified empirically — 2000 returns 400). */
export const RINGOVER_MAX_LIMIT = 1000;

/** Safety cap for paginated calls — yesterday's call volume should never exceed this on a normal day. */
export const RINGOVER_MAX_PAGES = 10;

export interface RingoverClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Optional `fetch` override (mainly for tests). */
  fetch?: typeof fetch;
}

export interface ListCallsParams {
  startDate: string; // ISO 8601
  endDate: string;
  limitCount?: number;
  /** If provided, paginate from this `cdr_id`. */
  lastIdOffset?: string | number;
}

export class RingoverError extends Error {
  constructor(public status: number, public body: string, message: string) {
    super(message);
    this.name = "RingoverError";
  }
}

/**
 * Thin Ringover Public API client. Auth is a raw API key in the `Authorization`
 * header (no `Bearer` prefix). See HANDOVER §1.
 */
export class RingoverClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RingoverClientOptions) {
    if (!opts.apiKey) throw new Error("RingoverClient: apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  /**
   * One page of calls. Use {@link listCallsBetween} for full-window iteration.
   */
  async listCallsPage(params: ListCallsParams) {
    const limit = Math.min(params.limitCount ?? RINGOVER_MAX_LIMIT, RINGOVER_MAX_LIMIT);
    const url = new URL(`${this.baseUrl}/calls`);
    url.searchParams.set("start_date", params.startDate);
    url.searchParams.set("end_date", params.endDate);
    url.searchParams.set("limit_count", String(limit));
    if (params.lastIdOffset != null) {
      url.searchParams.set("last_id_offset", String(params.lastIdOffset));
    }

    const res = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: this.apiKey,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await safeText(res);
      throw new RingoverError(res.status, body, `Ringover GET /calls failed (${res.status})`);
    }

    const json = await res.json();
    return listCallsResponseSchema.parse(json);
  }

  /**
   * Iterate every call between `start` and `end`, capped at {@link RINGOVER_MAX_PAGES}.
   * Pagination follows HANDOVER §1: pass the last batch's final `cdr_id` as `last_id_offset`.
   */
  async listCallsBetween(start: string, end: string): Promise<RingoverCall[]> {
    const all: RingoverCall[] = [];
    let cursor: string | number | undefined;
    for (let page = 0; page < RINGOVER_MAX_PAGES; page++) {
      const batch = await this.listCallsPage({
        startDate: start,
        endDate: end,
        limitCount: RINGOVER_MAX_LIMIT,
        lastIdOffset: cursor,
      });
      const calls = batch.call_list;
      if (calls.length === 0) break;
      all.push(...calls);
      if (calls.length < RINGOVER_MAX_LIMIT) break;
      const last = calls[calls.length - 1];
      cursor = last.cdr_id;
    }
    return all;
  }

  /**
   * List every Ringover user (agent) on the account, to build the operator
   * roster (user_id ↔ name ↔ email ↔ team). Read-only.
   *
   * The Public API isn't as well documented for this endpoint as for /calls, so
   * we accept the common envelope shapes defensively: a bare array, or an object
   * keyed by `user_list` / `list` / `users`.
   */
  async listUsers(): Promise<RingoverUser[]> {
    const url = new URL(`${this.baseUrl}/users`);
    url.searchParams.set("limit_count", String(RINGOVER_MAX_LIMIT));

    const res = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: this.apiKey,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await safeText(res);
      throw new RingoverError(res.status, body, `Ringover GET /users failed (${res.status})`);
    }

    const json: unknown = await res.json();
    const rawList: unknown = Array.isArray(json)
      ? json
      : isRecord(json)
        ? (json.user_list ?? json.list ?? json.users ?? [])
        : [];
    if (!Array.isArray(rawList)) return [];
    return rawList.map((u) => ringoverUserSchema.parse(u));
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
