import type { Language } from './setCode';

const SITE = 'https://www.cardmarket.com/fr/YuGiOh/Products';

// Cardmarket sells Asian prints as sets of their own, which the card database does not list.
const ASIAN: Language[] = ['Japanese', 'Korean', 'Asian English', 'Traditional Chinese', 'Simplified Chinese'];

// A name as Cardmarket writes it in its links: punctuation dropped, words joined by hyphens.
function slug(text: string): string {
  return text
    .replace(/[^A-Za-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}

// Where the price of a card can be checked. The page of the card itself when
// its link is certain; otherwise a search for its name. A card that has several
// rarities in one set carries a version number in its link that only Cardmarket knows.
export function cardmarketUrl(card: { name: string; setName: string; language: Language }, rarities: number): string {
  if (rarities === 1 && !ASIAN.includes(card.language)) {
    return `${SITE}/Singles/${slug(card.setName)}/${slug(card.name)}`;
  }
  return `${SITE}/Search?searchString=${encodeURIComponent(card.name)}`;
}
