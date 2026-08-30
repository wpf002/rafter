'use client';

import type { JobEvent } from '@rafter/types';

function summarize(payload: Record<string, unknown>): string {
  const s = JSON.stringify(payload);
  return s.length > 96 ? `${s.slice(0, 93)}…` : s;
}

/** SCREAMING_SNAKE event kinds are stored values; the log shows them in Title Case. */
function humanizeKind(kind: string): string {
  return kind
    .toLowerCase()
    .split('_')
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function EventLog({ events }: { events: JobEvent[] }) {
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <details className="card card-pad events section no-print">
      <summary>
        Event Log <span className="kanban-count">({events.length})</span>
      </summary>
      <div className="events-list">
        {sorted.map((ev) => (
          <div className="event-row" key={ev.id}>
            <span className="event-at">{new Date(ev.at).toLocaleString()}</span>
            <span className="event-kind">{humanizeKind(ev.kind)}</span>
            <span className="event-payload">{summarize(ev.payload)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
