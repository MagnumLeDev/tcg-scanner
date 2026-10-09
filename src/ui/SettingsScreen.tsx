import type { CardDatabase, Phase } from '../cardDatabase';
import { isInstalled } from '../installed';
import type { Source } from '../sources/types';

type Props = { db: CardDatabase; sources: Source[]; onChange: () => void };

const PHASE_LABEL: Record<Phase | 'idle', string | null> = {
  idle: null,
  downloading: 'Downloading…',
  saving: 'Saving…',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function SettingsScreen({ db, sources, onChange }: Props) {
  // Progress and errors are read from the database itself, so they are still
  // correct after leaving this screen and coming back during a download.
  function run(action: Promise<void>) {
    action.catch(() => {}).finally(onChange);
  }

  function unsubscribe(source: Source) {
    const question = `Unsubscribe from “${source.name}”? Its data is deleted from this phone. Your card list is kept.`;
    if (window.confirm(question)) run(db.unsubscribe(source.id));
  }

  return (
    <div className="pad stack">
      <h2>Card databases</h2>
      {sources.map((source) => {
        const subscription = db.subscriptions().find((s) => s.sourceId === source.id);
        const working = PHASE_LABEL[db.activity(source.id) ?? 'idle'];
        const error = db.failure(source.id) ?? subscription?.lastError;
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
                  onClick={() => run(db.subscribe(source.id))}
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
                  onClick={() => run(db.forceRefresh(source.id))}
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
      {!isInstalled() && (
        <p className="card">
          Add this app to your Home Screen before building your list. A browser tab can lose its saved data after a few
          days without use, and on iPhone the installed app does not share data with the Safari tab.
        </p>
      )}
      <p className="muted">
        Subscribed databases are checked for new cards each time the app opens. Scanning works offline once a database
        is downloaded.
      </p>
    </div>
  );
}
