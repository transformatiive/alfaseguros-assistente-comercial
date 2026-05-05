import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDailySummaryQueryKey,
  getGetRunStatusQueryKey,
  getListConversationsQueryKey,
  getListOperatorSummariesQueryKey,
} from "@workspace/api-client-react";

/**
 * Subscribe to /api/progress/:date Server-Sent Events and invalidate the
 * relevant React Query caches as conversation/summary/agent events arrive.
 */
export function useRunProgress(date: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!date) return;
    const url = `/api/progress/${encodeURIComponent(date)}`;
    const source = new EventSource(url);

    const invalidateRun = () =>
      queryClient.invalidateQueries({ queryKey: getGetRunStatusQueryKey(date) });
    const invalidateConvs = () =>
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey(date) });
    const invalidateSummary = () =>
      queryClient.invalidateQueries({ queryKey: getGetDailySummaryQueryKey(date) });
    const invalidateOperators = () =>
      queryClient.invalidateQueries({ queryKey: getListOperatorSummariesQueryKey(date) });

    source.addEventListener("run:start", invalidateRun);
    source.addEventListener("run:done", () => {
      invalidateRun();
      invalidateConvs();
      invalidateSummary();
      invalidateOperators();
    });
    source.addEventListener("run:error", invalidateRun);
    source.addEventListener("conv:start", invalidateRun);
    source.addEventListener("conv:done", () => {
      invalidateRun();
      invalidateConvs();
    });
    source.addEventListener("conv:error", invalidateRun);
    source.addEventListener("summary:done", () => {
      invalidateSummary();
      invalidateRun();
    });
    source.addEventListener("agents:done", () => {
      invalidateOperators();
      invalidateRun();
    });

    source.onerror = () => {
      // Native EventSource auto-reconnects with backoff; we only need to log.
      // eslint-disable-next-line no-console
      console.warn("SSE /api/progress error (will auto-reconnect)");
    };

    return () => {
      source.close();
    };
  }, [date, queryClient]);
}
