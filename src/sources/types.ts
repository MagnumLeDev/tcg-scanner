import type { Language } from '../setCode';

export type Printing = {
  code: string; // as indexed by the source, e.g. "LOB-EN001"
  cardId: number; // the same for every printing of a card; 0 in data saved before names existed
  name: string;
  setName: string;
  rarity: string;
};

export type CardName = [cardId: number, name: string];

export type Source = {
  id: string;
  name: string; // shown in Settings
  fetchVersion(): Promise<string>;
  fetchPrintings(): Promise<Printing[]>;
  nameLanguages: Language[]; // languages other than English it has card names in
  fetchNames(language: Language): Promise<CardName[]>;
};
