export type CashEventType = 'deposit' | 'withdrawal';

export interface CashEvent {
  id: string;
  accountId: string;
  // Firestore creation timestamp used for deterministic tie-breaking.
  createdAt?: Date;
  type: CashEventType;
  date: Date;
  amount: number;
  currency: string;
  notes?: string;
}
