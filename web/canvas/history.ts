export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

// Bound the undo stack so long editing sessions don't retain every snapshot forever.
const HISTORY_LIMIT = 100;

function capPast<T>(past: T[]): T[] {
  return past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past;
}

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

export function pushHistory<T>(history: HistoryState<T>, next: T): HistoryState<T> {
  return {
    past: capPast([...history.past, history.present]),
    present: next,
    future: []
  };
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future]
  };
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: capPast([...history.past, history.present]),
    present: next,
    future: history.future.slice(1)
  };
}
