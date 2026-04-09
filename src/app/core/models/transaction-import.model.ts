import { TransactionType } from './transaction.model';

export interface ImportCandidate {
  transactionDate?: string;
  type?: TransactionType;
  symbol?: string;
  fullName?: string;
  quantity?: number;
  price?: number;
  fees?: number;
  notes?: string;
}

export interface TransactionImportResult {
  parsedTransaction?: ImportCandidate;
  warnings: string[];
  confidence: number;
  diagnostics?: string[];
}

export interface TransactionFormPrefillPayload {
  transactionDate?: string | Date;
  type?: TransactionType;
  symbol?: string;
  fullName?: string;
  quantity?: number;
  price?: number;
  fees?: number;
  notes?: string;
}