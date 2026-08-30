'use client';

import type { JobEvent } from '@rafter/types';

function summarize(payload: Record<string, unknown>): string {
  const s = JSON.stringify(payload);
  return s.length > 96 ? `${s.slice(0, 93)}…` : s;
}

export function EventLog({ events }: { events: JobEvent[] }) {
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <details className="card card-pad events section no-print">
      <summary>
        Event log <span className="kanban-count">({events.length})</span>
      </summary>
      <div className="events-list">
        {sorted.map((ev) => (
          <div className="event-row" key={ev.id}>
            <span className="event-at">{new Date(ev.at).toLocaleString()}</span>
            <span className="event-kind">{ev.kind}</span>
            <span className="event-payload">{summarize(ev.payload)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
