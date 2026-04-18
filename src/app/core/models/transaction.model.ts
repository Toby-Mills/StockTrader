export type TransactionType = 'buy' | 'sell' | 'swap';

export interface Transaction {
  id: string;
  accountId: string;
  // Firestore creation timestamp used for deterministic tie-breaking.
  createdAt?: Date;
  symbol: string;      // e.g. 'AAPL', 'VOD.L' — for swaps, this is the outgoing (from) symbol
  type: TransactionType;
  date: Date;
  quantity: number;    // for swaps, this is the number of outgoing (from) shares
  price: number;
  currency: string;
  fees?: number;
  notes?: string;
  // Swap-only fields
  toSymbol?: string;   // the incoming (to) symbol
  toQuantity?: number; // the number of incoming (to) shares
}
