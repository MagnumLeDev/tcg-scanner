import { useState } from 'react';
import type { CardDatabase, Phase } from '../cardDatabase';
import type { Source } from '../sources/types';

type Props = { db: CardDatabase; sources: Source[]; onChange: () => void };

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function SettingsScreen({ db, sources, onChange }: Props) {
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function run(sourceId: string, action: (onProgress: (phase: Phase) => void) => Promise<void>) {
    setErrors((current) => ({ ...current, [sourceId]: '' }));
    setBusy((current) => ({ ...current, [sourceId]: 'Starting…' }));
    try {
      await action((phase) =>
        setBusy((current) => ({ ...current, [sourceId]: phase === 'downloading' ? 'Downloading…' : 'Saving…' })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrors((current) => ({ ...current, [sourceId]: message }));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[sourceId];
        return next;
      });
      onChange();
    }
  }

  function unsubscribe(source: Source) {
    const question = `Unsubscribe from “${source.name}”? Its data is deleted from this phone. Your card list is kept.`;
    if (window.confirm(question)) void run(source.id, () => db.unsubscribe(source.id));
  }

  return (
    <div className="pad stack">
      <h2>Card databases</h2>
      {sources.map((source) => {
        const subscription = db.subscriptions().find((s) => s.sourceId === source.id);
        const working = busy[source.id];
        const error = errors[source.id] || subscription?.lastError;
        return (
          <section className="card stack" key={source.id}>
            <div className="row">
              <strong className="grow">{source.name}</strong>
              {subscription ? (
                <button className="danger" disabled={!!working} onClick={() => unsubscribe(source)}>
                  Unsubscribe
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!!working}
                  onClick={() => void run(source.id, (onProgress) => db.subscribe(source.id, onProgress))}
                >
                  Subscribe
                </button>
              )}
            </div>

            {subscription && (
              <>
                <div className="muted">
                  Version {subscription.version} · {subscription.count.toLocaleString()} printings
                  <br />
                  Updated {when(subscription.updatedAt)}
                  <br />
                  Last checked {when(subscription.checkedAt)}
                </div>
                <button
                  disabled={!!working}
                  onClick={() => void run(source.id, (onProgress) => db.forceRefresh(source.id, onProgress))}
                >
                  Force refresh
                </button>
              </>
            )}

            {working && <div className="muted">{working}</div>}
            {!working && error && <div className="error">Last attempt failed: {error}</div>}
          </section>
        );
      })}
      <p className="muted">
        Subscribed databases are checked for new cards each time the app opens. Scanning works offline once a database
        is downloaded.
      </p>
    </div>
  );
}
