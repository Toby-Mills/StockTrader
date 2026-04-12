export interface Dividend {
  id: string;
  accountId: string;
  // Firestore creation timestamp used for deterministic tie-breaking.
  createdAt?: Date;
  symbol: string;
  dividendTypeId?: string;
  date: Date;
  amount: number;
  currency: string;
  sharesHeld?: number;
  notes?: string;
}
