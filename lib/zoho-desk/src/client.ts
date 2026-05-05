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
  /** Sort order — defaults to ascending by createdTime. */
  sortBy?: string;
  /** Override the default field list (be sure to keep `cf` if you need outcome data). */
  fields?: string[];
  /** Defaults to `contacts,assignee` per HANDOVER §1. */
  include?: string;
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
    return res.json();
  }

  /**
   * Page through tickets created in `[createdTimeFrom, createdTimeTo]`. Returns
   * everything in memory; expected daily-window volumes are a few hundred.
   */
  async listTicketsCreatedBetween(params: ListTicketsParams): Promise<ZohoTicket[]> {
    const include = params.include ?? "contacts,assignee";
    const fields = (params.fields ?? DEFAULT_TICKET_FIELDS).join(",");
    const sortBy = params.sortBy ?? "createdTime";

    const all: ZohoTicket[] = [];
    let from = 0;
    // Hard cap to keep us from infinite-looping on a buggy response.
    for (let page = 0; page < 200; page++) {
      const json = await this.request("/tickets", {
        from: String(from),
        limit: String(TICKETS_PAGE_SIZE),
        include,
        fields,
        sortBy,
        createdTimeRange: `${params.createdTimeFrom},${params.createdTimeTo}`,
      });
      const parsed = ticketsListResponseSchema.parse(json);
      const batch = parsed.data ?? [];
      if (batch.length === 0) break;
      all.push(...batch);
      if (batch.length < TICKETS_PAGE_SIZE) break;
      from += TICKETS_PAGE_SIZE;
    }
    return all;
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
