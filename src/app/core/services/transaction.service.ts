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
import { Observable, map } from 'rxjs';
import { Transaction } from '../models/transaction.model';
import { AuthService } from './auth.service';
import { stripUndefined } from '../utils/strip-undefined';
import { sortByDateAndCreatedAt } from '../utils/record-sort';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);

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
      .pipe(map(transactions => sortByDateAndCreatedAt(transactions)));
  }

  addTransaction(accountId: string, tx: Omit<Transaction, 'id' | 'accountId' | 'createdAt'>): Promise<void> {
    return addDoc(this.txRef(accountId), stripUndefined({
      ...tx,
      accountId,
      createdAt: serverTimestamp(),
    })).then(() => undefined);
  }

  updateTransaction(accountId: string, id: string, changes: Partial<Transaction>): Promise<void> {
    this.requireAuth();
    const payload = stripUndefined(changes) as UpdateData<Transaction>;
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
