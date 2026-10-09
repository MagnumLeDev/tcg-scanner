import { useEffect, useState } from 'react';
import type { CardDatabase } from '../cardDatabase';
import { match, suggestions } from '../cardMatch';
import type { NewEntry } from '../collection';
import { extract, LANGUAGES, languageOf, parse, type Language } from '../setCode';

type Props = {
  db: CardDatabase;
  initialCode: string;
  hint: string | null;
  onAdd: (entry: NewEntry) => void;
  onClose: (() => void) | null;
};

export function ResultPanel({ db, initialCode, hint, onAdd, onClose }: Props) {
  const [text, setText] = useState(initialCode);
  const code = extract(text);
  const found = code ? match(db, code) : null;
  const near = code && !found ? suggestions(db, code) : [];
  const rarities = found ? [...new Set(found.printings.map((p) => p.rarity))] : [];

  const [language, setLanguage] = useState<Language>('Unknown');
  const [rarity, setRarity] = useState('');

  // Whenever the code changes, restart from what the code itself says.
  useEffect(() => {
    setLanguage(code ? languageOf(parse(code).region) : 'Unknown');
    setRarity(rarities.length === 1 ? rarities[0] : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, found?.matchedCode]);

  const printing = found?.printings.find((p) => p.rarity === rarity) ?? null;
  const canAdd = !!code && !!found && !!printing && language !== 'Unknown';

  function add() {
    if (!code || !found || !printing || language === 'Unknown') return;
    onAdd({
      code,
      matchedCode: found.matchedCode,
      language,
      name: printing.name,
      setName: printing.setName,
      rarity: printing.rarity,
    });
  }

  return (
    <div className="result pad stack">
      {hint && <p className="muted">{hint}</p>}

      <label className="stack">
        <span className="muted">Set code</span>
        <input
          value={text}
          onChange={(event) => setText(event.target.value.toUpperCase())}
          placeholder="LOB-EN001"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>

      {code && found && (
        <div>
          <strong>{found.printings[0].name}</strong>
          <div className="muted">{found.printings[0].setName}</div>
        </div>
      )}

      {code && !found && (
        <div className="stack">
          <div className="error">Card not found</div>
          {near.length > 0 && (
            <div className="row wrap">
              <span className="muted">Did you mean</span>
              {near.map((suggestion) => (
                <button key={suggestion} onClick={() => setText(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {found && (
        <label className="stack">
          <span className="muted">Language</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
            {LANGUAGES.map((option) => (
              <option key={option} value={option}>
                {option === 'Unknown' ? 'Unknown — choose one' : option}
              </option>
            ))}
          </select>
        </label>
      )}

      {found && rarities.length > 1 && (
        <label className="stack">
          <span className="muted">Rarity — this code exists in several</span>
          <select value={rarity} onChange={(event) => setRarity(event.target.value)}>
            <option value="">Choose a rarity</option>
            {rarities.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )}

      {found && rarities.length === 1 && <div className="muted">{rarities[0]}</div>}

      <div className="row">
        {onClose && (
          <button className="grow" onClick={onClose}>
            Retry
          </button>
        )}
        <button className="primary grow" disabled={!canAdd} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}
