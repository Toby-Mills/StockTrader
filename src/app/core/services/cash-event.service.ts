import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  UpdateData,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { CashEvent } from '../models/cash-event.model';
import { AuthService } from './auth.service';
import { stripUndefined } from '../utils/strip-undefined';
import { sortByDateAndCreatedAt } from '../utils/record-sort';

@Injectable({ providedIn: 'root' })
export class CashEventService {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);

  private requireAuth(): void {
    this.authService.requireUserUid();
  }

  private cashEventRef(accountId: string) {
    this.requireAuth();
    return collection(this.firestore, 'accounts', accountId, 'cash-events');
  }

  getCashEvents(accountId: string): Observable<CashEvent[]> {
    const q = query(this.cashEventRef(accountId), orderBy('date', 'desc'));
    return (collectionData(q, { idField: 'id' }) as Observable<CashEvent[]>)
      .pipe(map(events => sortByDateAndCreatedAt(events)));
  }

  addCashEvent(accountId: string, event: Omit<CashEvent, 'id' | 'accountId' | 'createdAt'>): Promise<void> {
    return addDoc(this.cashEventRef(accountId), stripUndefined({
      ...event,
      accountId,
      createdAt: serverTimestamp(),
    })).then(() => undefined);
  }

  updateCashEvent(accountId: string, id: string, changes: Partial<CashEvent>): Promise<void> {
    this.requireAuth();
    const payload = stripUndefined(changes) as UpdateData<CashEvent>;
    return updateDoc(doc(this.firestore, 'accounts', accountId, 'cash-events', id), payload);
  }

  deleteCashEvent(accountId: string, id: string): Promise<void> {
    this.requireAuth();
    return deleteDoc(doc(this.firestore, 'accounts', accountId, 'cash-events', id));
  }
}
