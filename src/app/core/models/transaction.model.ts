export type TransactionType = 'buy' | 'sell';

export interface Transaction {
  id: string;
  accountId: string;
  // Firestore creation timestamp used for deterministic tie-breaking.
  createdAt?: Date;
  symbol: string;      // e.g. 'AAPL', 'VOD.L'
  type: TransactionType;
  date: Date;
  quantity: number;
  price: number;
  currency: string;
  fees?: number;
  notes?: string;
}
