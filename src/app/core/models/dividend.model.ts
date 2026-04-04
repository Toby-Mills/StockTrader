export interface Dividend {
  id: string;
  accountId: string;
  symbol: string;
  dividendTypeId?: string;
  date: Date;
  amount: number;
  currency: string;
  sharesHeld?: number;
  notes?: string;
}
