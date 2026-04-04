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
  updateDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { TrackedSymbol } from '../models/tracked-symbol.model';
import { AuthService } from './auth.service';
import { stripUndefined } from '../utils/strip-undefined';

@Injectable({ providedIn: 'root' })
export class SymbolCatalogService {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);

  private requireAuth(): void {
    this.authService.requireUserUid();
  }

  private symbolsRef(accountId: string) {
    this.requireAuth();
    return collection(this.firestore, 'accounts', accountId, 'symbols');
  }

  getSymbols(accountId: string): Observable<TrackedSymbol[]> {
    const q = query(this.symbolsRef(accountId), orderBy('symbol', 'asc'));
    return collectionData(q, { idField: 'id' }) as Observable<TrackedSymbol[]>;
  }

  addSymbol(accountId: string, symbol: Omit<TrackedSymbol, 'id' | 'accountId'>): Promise<void> {
    const payload = stripUndefined({
      ...symbol,
      symbol: symbol.symbol.trim().toUpperCase(),
      fullName: symbol.fullName.trim(),
      accountId,
    });

    return addDoc(this.symbolsRef(accountId), payload).then(() => undefined);
  }

  updateSymbol(accountId: string, id: string, changes: Partial<TrackedSymbol>): Promise<void> {
    this.requireAuth();

    const payload = stripUndefined({
      ...changes,
      symbol: changes.symbol?.trim().toUpperCase(),
      fullName: changes.fullName?.trim(),
    }) as UpdateData<TrackedSymbol>;

    return updateDoc(doc(this.firestore, 'accounts', accountId, 'symbols', id), payload);
  }

  deleteSymbol(accountId: string, id: string): Promise<void> {
    this.requireAuth();
    return deleteDoc(doc(this.firestore, 'accounts', accountId, 'symbols', id));
  }
}
