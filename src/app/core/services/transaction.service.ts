import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  UpdateData,
  collection,
  collectionData,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Observable, map, tap } from 'rxjs';
import { Transaction } from '../models/transaction.model';
import { AuthService } from './auth.service';
import { stripUndefined } from '../utils/strip-undefined';
import { sortByDateAndCreatedAt } from '../utils/record-sort';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private static readonly DEBUG_SWAPS = true;

  private requireAuth(): void {
    this.authService.requireUserUid();
  }

  private txRef(accountId: string) {
    this.requireAuth();
    return collection(this.firestore, 'accounts', accountId, 'transactions');
  }

  getTransactions(accountId: string): Observable<Transaction[]> {
    const q = query(this.txRef(accountId), orderBy('date', 'desc'));
    return (collectionData(q, { idField: 'id' }) as Observable<Transaction[]>)
      .pipe(
        map(transactions => sortByDateAndCreatedAt(transactions)),
        tap(transactions => {
          if (!TransactionService.DEBUG_SWAPS) {
            return;
          }

          const swapRows = transactions.filter(tx => tx.type === 'swap' || tx.toSymbol || tx.toQuantity != null);
          if (!swapRows.length) {
            return;
          }

          console.groupCollapsed('[SwapDebug][Service][Read] Transactions emitted');
          console.log('accountId', accountId);
          console.log('swapRows', swapRows.map(tx => ({
            id: tx.id,
            type: tx.type,
            symbol: tx.symbol,
            toSymbol: tx.toSymbol,
            quantity: tx.quantity,
            toQuantity: tx.toQuantity,
            price: tx.price,
            fees: tx.fees,
          })));
          console.groupEnd();
        })
      );
  }

  addTransaction(accountId: string, tx: Omit<Transaction, 'id' | 'accountId' | 'createdAt'>): Promise<void> {
    if (TransactionService.DEBUG_SWAPS && (tx.type === 'swap' || tx.toSymbol || tx.toQuantity != null)) {
      console.groupCollapsed('[SwapDebug][Service][Add] Before stripUndefined');
      console.log('accountId', accountId);
      console.log('tx', tx);
      console.groupEnd();
    }

    return addDoc(this.txRef(accountId), stripUndefined({
      ...tx,
      accountId,
      createdAt: serverTimestamp(),
    })).then(() => undefined);
  }

  updateTransaction(accountId: string, id: string, changes: Partial<Transaction>): Promise<void> {
    this.requireAuth();
    const payload = stripUndefined(changes) as UpdateData<Transaction>;

    if (TransactionService.DEBUG_SWAPS && (changes.type === 'swap' || changes.toSymbol || changes.toQuantity != null)) {
      console.groupCollapsed('[SwapDebug][Service][Update] Before updateDoc');
      console.log('accountId', accountId);
      console.log('id', id);
      console.log('changes', changes);
      console.log('payload', payload);
      console.groupEnd();
    }

    return updateDoc(
      doc(this.firestore, 'accounts', accountId, 'transactions', id),
      payload
    );
  }

  deleteTransaction(accountId: string, id: string): Promise<void> {
    this.requireAuth();
    return deleteDoc(doc(this.firestore, 'accounts', accountId, 'transactions', id));
  }
}
