import { ZohoAuth } from "./auth.js";
import {
  commentsListResponseSchema,
  ticketsListResponseSchema,
  type ZohoComment,
  type ZohoTicket,
} from "./types.js";

const DEFAULT_DESK_BASE_URL = "https://desk.zoho.com/api/v1";
const TICKETS_PAGE_SIZE = 100; // max per Zoho Desk

/**
 * Default field set requested from Zoho Desk. We include `cf` so all custom
 * fields come through; the outcome classifier reads these later.
 */
export const DEFAULT_TICKET_FIELDS = [
  "id",
  "ticketNumber",
  "subject",
  "status",
  "statusType",
  "channel",
  "category",
  "productName",
  "resolution",
  "contactId",
  "assigneeId",
  "createdTime",
  "modifiedTime",
  "closedTime",
  "cf",
];

export interface ZohoDeskClientOptions {
  auth: ZohoAuth;
  orgId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ListTicketsParams {
  /** Lower bound on `createdTime` (ISO 8601). */
  createdTimeFrom: string;
  /** Upper bound on `createdTime` (ISO 8601). */
  createdTimeTo: string;
  /** Override the default field list (be sure to keep `cf` if you need outcome data). */
  fields?: string[];
  /** Defaults to `contacts,assignee` per HANDOVER §1. */
  include?: string;
  /** Restrict to a single Zoho Desk department (passed to every `/tickets` request). */
  departmentId?: string;
}

export class ZohoDeskError extends Error {
  constructor(
    public status: number,
    public body: string,
    message: string,
  ) {
    super(message);
    this.name = "ZohoDeskError";
  }
}

export class ZohoDeskClient {
  private readonly auth: ZohoAuth;
  private readonly orgId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ZohoDeskClientOptions) {
    if (!opts.orgId) throw new Error("ZohoDeskClient: orgId is required");
    this.auth = opts.auth;
    this.orgId = opts.orgId;
    this.baseUrl = opts.baseUrl ?? DEFAULT_DESK_BASE_URL;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const doFetch = async (): Promise<Response> => {
      const token = await this.auth.getAccessToken();
      return this.fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          orgId: this.orgId,
          Accept: "application/json",
        },
      });
    };

    let res = await doFetch();
    if (res.status === 401) {
      // Token may have expired between cache and now; force refresh and retry once.
      this.auth.invalidate();
      res = await doFetch();
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ZohoDeskError(res.status, body, `Zoho Desk GET ${path} failed (${res.status})`);
    }
    if (res.status === 204) return { data: [] };
    const text = await res.text();
    if (!text || text.trim() === "") return { data: [] };
    return JSON.parse(text);
  }

  /**
   * Page through tickets created in `[createdTimeFrom, createdTimeTo]`.
   *
   * The Zoho Desk v1 API does not support date-range query parameters — only
   * offset-based pagination sorted by `createdTime` ascending. We use a binary
   * search to find the approximate starting offset so we don't have to walk
   * the entire history (can be 10 000+ rows). Typically ~10 probe requests
   * + a handful of forward pages.
   */
  async listTicketsCreatedBetween(params: ListTicketsParams): Promise<ZohoTicket[]> {
    const include = params.include ?? "contacts,assignee";
    const fields = (params.fields ?? DEFAULT_TICKET_FIELDS).join(",");
    const departmentId = params.departmentId;
    const winFrom = new Date(params.createdTimeFrom).getTime();
    const winTo = new Date(params.createdTimeTo).getTime();

    // Step 1 — binary search for a safe starting offset (first ticket >= winFrom).
    const startOffset = await this.binarySearchCreatedTime(winFrom, departmentId);

    // Step 2 — paginate forward from startOffset, stopping once past winTo.
    const all: ZohoTicket[] = [];
    let from = startOffset;

    for (let page = 0; page < 50; page++) {
      const json = await this.request("/tickets", {
        from: String(from),
        limit: String(TICKETS_PAGE_SIZE),
        include,
        fields,
        sortBy: "createdTime",
        ...(departmentId ? { departmentId } : {}),
      });
      const parsed = ticketsListResponseSchema.parse(json);
      const batch = parsed.data ?? [];
      if (batch.length === 0) break;

      let pastWindow = false;
      for (const t of batch) {
        if (!t.createdTime) continue;
        const ts = new Date(t.createdTime).getTime();
        if (ts > winTo) { pastWindow = true; break; }
        if (ts >= winFrom) all.push(t);
      }

      if (pastWindow || batch.length < TICKETS_PAGE_SIZE) break;
      from += TICKETS_PAGE_SIZE;
    }

    return all;
  }

  /**
   * Binary-search the Zoho ticket list (sorted ascending by createdTime) to
   * find the offset of the first ticket whose createdTime >= `targetMs`.
   * Returns an offset slightly before the target as a safety margin.
   *
   * Uses only `from`, `limit=1`, and `sortBy=createdTime` — the minimal set
   * of parameters accepted by the Zoho Desk v1 `/tickets` endpoint.
   */
  private async binarySearchCreatedTime(targetMs: number, departmentId?: string): Promise<number> {
    let lo = 0;
    let hi = 200_000; // generous upper bound; binary search stays fast

    while (hi - lo > TICKETS_PAGE_SIZE) {
      const mid = Math.floor((lo + hi) / 2);
      const json = await this.request("/tickets", {
        from: String(mid),
        limit: "1",
        sortBy: "createdTime",
        ...(departmentId ? { departmentId } : {}),
      });
      const parsed = ticketsListResponseSchema.parse(json);
      const batch = parsed.data ?? [];

      if (batch.length === 0) {
        // Past the end of the list — binary-search backwards.
        hi = mid;
        continue;
      }

      const ts = batch[0].createdTime ? new Date(batch[0].createdTime).getTime() : 0;
      if (ts < targetMs) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    // Step back a bit so we don't miss tickets right at the boundary.
    return Math.max(0, lo - TICKETS_PAGE_SIZE);
  }

  /** All comments for a ticket, paged at 100 per request (Zoho's max). */
  async listTicketComments(ticketId: string): Promise<ZohoComment[]> {
    const all: ZohoComment[] = [];
    let from = 0;
    for (let page = 0; page < 200; page++) {
      const json = await this.request(`/tickets/${encodeURIComponent(ticketId)}/comments`, {
        from: String(from),
        limit: "100",
      });
      const parsed = commentsListResponseSchema.parse(json);
      const batch = parsed.data ?? [];
      if (batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 100) break;
      from += 100;
    }
    return all;
  }
}
