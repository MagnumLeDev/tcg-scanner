import { useEffect, useState } from 'react';
import { createCardDatabase, type UpdateResult } from './cardDatabase';
import { createCollection, type Entry, type NewEntry } from './collection';
import { SOURCES } from './sources';
import { ScanScreen } from './ui/ScanScreen';
import { SettingsScreen } from './ui/SettingsScreen';

type Tab = 'scan' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'settings', label: 'Settings' },
];

const db = createCardDatabase(SOURCES, indexedDB);
const collection = createCollection(localStorage);

// Memoised at module level so React StrictMode's double effect run in development
// does not load or check twice.
let loading: Promise<void> | null = null;
let checking: Promise<UpdateResult[]> | null = null;
const loadOnce = () => (loading ??= db.load());
const checkOnce = () => (checking ??= db.checkForUpdates());

export default function App() {
  const [tab, setTab] = useState<Tab>('scan');
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setRevision] = useState(0);
  const refresh = () => setRevision((revision) => revision + 1);
  const [entries, setEntries] = useState<Entry[]>(collection.all());

  function showSaved(saved: boolean, message: string) {
    setEntries(collection.all());
    setNotice(saved ? message : 'Changed, but the list could not be saved on this phone. Export it to keep a copy.');
  }

  function handleAdd(entry: NewEntry) {
    showSaved(collection.add(entry), `Added ${entry.name}`);
  }

  useEffect(() => {
    let active = true;
    loadOnce()
      .then(() => {
        if (active) setReady(true);
        return checkOnce();
      })
      .then((results) => {
        if (!active) return;
        refresh();
        const updated = results.filter((result) => result.updated);
        if (updated.length > 0) {
          const added = updated.reduce((sum, result) => sum + result.added, 0);
          setNotice(`Card database updated — ${added.toLocaleString()} new printings`);
        }
      })
      .catch(() => {
        if (!active) return;
        setReady(true);
        setNotice('Could not open card database storage on this phone.');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="app">
      <header className="topbar">YGO Scanner · {entries.reduce((sum, entry) => sum + entry.quantity, 0)} cards</header>
      <main className="screen">
        {!ready && <p className="pad muted">Loading…</p>}
        {ready && tab === 'scan' && (
          <ScanScreen db={db} onAdd={handleAdd} onOpenSettings={() => setTab('settings')} />
        )}
        {ready && tab === 'settings' && <SettingsScreen db={db} sources={SOURCES} onChange={refresh} />}
        {notice && (
          <div className="notice" role="status" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
      </main>
      <nav className="tabs">
        {TABS.map(({ id, label }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
