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
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Dividend } from '../models/dividend.model';
import { AuthService } from './auth.service';
import { stripUndefined } from '../utils/strip-undefined';

@Injectable({ providedIn: 'root' })
export class DividendService {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);

  private requireAuth(): void {
    this.authService.requireUserUid();
  }

  private divRef(accountId: string) {
    this.requireAuth();
    return collection(this.firestore, 'accounts', accountId, 'dividends');
  }

  getDividends(accountId: string): Observable<Dividend[]> {
    const q = query(this.divRef(accountId), orderBy('date', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<Dividend[]>;
  }

  addDividend(accountId: string, div: Omit<Dividend, 'id' | 'accountId'>): Promise<void> {
    return addDoc(this.divRef(accountId), stripUndefined({ ...div, accountId })).then(() => undefined);
  }

  updateDividend(accountId: string, id: string, changes: Partial<Dividend>): Promise<void> {
    this.requireAuth();
    const payload = stripUndefined(changes) as UpdateData<Dividend>;
    return updateDoc(
      doc(this.firestore, 'accounts', accountId, 'dividends', id),
      payload
    );
  }

  deleteDividend(accountId: string, id: string): Promise<void> {
    this.requireAuth();
    return deleteDoc(doc(this.firestore, 'accounts', accountId, 'dividends', id));
  }
}
