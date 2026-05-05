import { EventEmitter } from "node:events";

export type RunEvent =
  | { type: "run:start"; date: string; total: number }
  | { type: "run:done"; date: string; analyzed: number; costUsd: number }
  | { type: "run:error"; date: string; message: string }
  | { type: "conv:start"; date: string; conversationId: number; customerPhone: string }
  | { type: "conv:done"; date: string; conversationId: number; costUsd: number }
  | { type: "conv:error"; date: string; conversationId: number; message: string }
  | { type: "summary:done"; date: string; costUsd: number }
  | { type: "agents:done"; date: string; count: number; costUsd: number };

const emitters = new Map<string, EventEmitter>();

function emitterFor(date: string): EventEmitter {
  let e = emitters.get(date);
  if (!e) {
    e = new EventEmitter();
    e.setMaxListeners(50);
    emitters.set(date, e);
  }
  return e;
}

export function publishRunEvent(event: RunEvent): void {
  emitterFor(event.date).emit("event", event);
}

export function subscribeRunEvents(date: string, listener: (e: RunEvent) => void): () => void {
  const e = emitterFor(date);
  e.on("event", listener);
  return () => e.off("event", listener);
}
