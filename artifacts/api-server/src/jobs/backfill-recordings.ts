/**
 * Cheap backfill of `recordingUrls` for conversations already stored on a date.
 *
 * The forward pipeline (analyze-day) already extracts and persists recording
 * URLs. This job exists to repopulate rows that were stored before that was
 * effective, WITHOUT paying for an LLM re-analysis: it re-fetches the day's
 * Ringover calls, regroups them, and updates only the recordingUrls column on
 * matching conversation rows.
 */
import { RingoverClient } from "@workspace/ringover";
import { groupIntoConversations } from "../grouping/conversations.js";
import { lisbonDayBoundsISO } from "../lib/dates.js";
import { backfillRecordingUrls } from "../storage/repo.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export interface BackfillRecordingsResult {
  date: string;
  conversations: number; // grouped from Ringover
  matched: number; // existing rows updated
  withRecordings: number; // updated rows that now have ≥1 URL
  totalUrls: number;
}

export async function backfillRecordingsForDate(date: string): Promise<BackfillRecordingsResult> {
  const cfg = env();
  if (!cfg.RINGOVER_API_KEY) throw new Error("RINGOVER_API_KEY not configured");

  const ringover = new RingoverClient({ apiKey: cfg.RINGOVER_API_KEY });
  const [start, end] = lisbonDayBoundsISO(date);
  const calls = await ringover.listCallsBetween(start, end);
  const groups = groupIntoConversations(calls);

  let matched = 0;
  let withRecordings = 0;
  let totalUrls = 0;
  for (const g of groups) {
    const n = await backfillRecordingUrls(date, g.customerPhone, g.recordingUrls);
    if (n > 0) {
      matched += n;
      if (g.recordingUrls.length > 0) {
        withRecordings += n;
        totalUrls += g.recordingUrls.length;
      }
    }
  }

  const result: BackfillRecordingsResult = {
    date,
    conversations: groups.length,
    matched,
    withRecordings,
    totalUrls,
  };
  logger.info(result, "recordings backfill complete");
  return result;
}
