export interface SessionCursor {
  lastTime: number;
  lastMessageId?: number;
  lastSeenAt?: number;
}

export interface WatchState {
  version: number;
  cursors: Record<string, SessionCursor>;
  seen: Record<string, 1>;
  pending: unknown[];
  lastDigestAt: number;
  lastRunAt?: number;
  stats: { polls: number; delivered: number; failed: number; restarts: number };
}

export function emptyState(): WatchState;
export function loadState(path: string): { state: WatchState; recoveredFrom?: string };
export function saveStateAtomic(path: string, state: WatchState): void;
export function advanceCursor(state: WatchState, key: string, time: number, messageId?: number): void;
export function isNewMessage(state: WatchState, key: string, time: number, messageId?: number): boolean;
export function summarize(state: WatchState): {
  sessions: number;
  pending: number;
  lastRunAt?: string;
  polls: number;
  delivered: number;
  failed: number;
  restarts: number;
};
