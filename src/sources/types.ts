export type Printing = {
  code: string; // as indexed by the source, e.g. "LOB-EN001"
  name: string;
  setName: string;
  rarity: string;
};

export type Source = {
  id: string;
  name: string; // shown in Settings
  fetchVersion(): Promise<string>;
  fetchPrintings(): Promise<Printing[]>;
};
