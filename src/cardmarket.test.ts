import { describe, expect, it } from 'vitest';
import { cardmarketUrl } from './cardmarket';

const SINGLES = 'https://www.cardmarket.com/fr/YuGiOh/Products/Singles';
const SEARCH = 'https://www.cardmarket.com/fr/YuGiOh/Products/Search?searchString=';

describe('cardmarketUrl', () => {
  it('links straight to a card that has one rarity in its set', () => {
    const card = { name: 'Call of the Mummy', setName: 'Speed Duel GX: Duelists of Shadows', language: 'French' } as const;
    expect(cardmarketUrl(card, 1)).toBe(`${SINGLES}/Speed-Duel-GX-Duelists-of-Shadows/Call-of-the-Mummy`);
  });

  it('drops punctuation from the names and keeps their hyphens', () => {
    const card = { name: 'Disaster, Dragon Ruler of All Apocalypses', setName: 'Alliance Insight', language: 'English' } as const;
    expect(cardmarketUrl(card, 1)).toBe(`${SINGLES}/Alliance-Insight/Disaster-Dragon-Ruler-of-All-Apocalypses`);
    const other = { name: 'Blue-Eyes White Dragon', setName: "Legendary Collection 4: Joey's World Mega Pack", language: 'English' } as const;
    expect(cardmarketUrl(other, 1)).toBe(`${SINGLES}/Legendary-Collection-4-Joeys-World-Mega-Pack/Blue-Eyes-White-Dragon`);
  });

  it('searches for the name when the set has the card in several rarities', () => {
    const card = { name: 'Trap Dustshoot', setName: 'Rarity Collection 5', language: 'French' } as const;
    expect(cardmarketUrl(card, 7)).toBe(`${SEARCH}Trap%20Dustshoot`);
  });

  it('searches for the name when the rarities are not known', () => {
    const card = { name: 'Trap Dustshoot', setName: 'Rarity Collection 5', language: 'French' } as const;
    expect(cardmarketUrl(card, 0)).toBe(`${SEARCH}Trap%20Dustshoot`);
  });

  it('searches for the name of an Asian print, which is sold as another set', () => {
    for (const language of ['Japanese', 'Korean', 'Asian English', 'Traditional Chinese', 'Simplified Chinese'] as const) {
      const card = { name: 'Call of the Mummy', setName: 'Speed Duel GX: Duelists of Shadows', language };
      expect(cardmarketUrl(card, 1)).toBe(`${SEARCH}Call%20of%20the%20Mummy`);
    }
  });
});
