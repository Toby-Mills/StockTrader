import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  UpdateData,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { DividendType } from '../models/dividend-type.model';
import { AuthService } from './auth.service';
import { stripUndefined } from '../utils/strip-undefined';

@Injectable({ providedIn: 'root' })
export class DividendTypeService {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);

  private requireAuth(): void {
    this.authService.requireUserUid();
  }

  private typesRef(accountId: string) {
    this.requireAuth();
    return collection(this.firestore, 'accounts', accountId, 'dividend-types');
  }

  getDividendTypes(accountId: string): Observable<DividendType[]> {
    const q = query(this.typesRef(accountId), orderBy('name', 'asc'));
    return collectionData(q, { idField: 'id' }) as Observable<DividendType[]>;
  }

  addDividendType(accountId: string, type: Omit<DividendType, 'id' | 'accountId'>): Promise<string> {
    const payload = stripUndefined({
      ...type,
      name: type.name.trim(),
      description: type.description?.trim(),
      accountId,
    });

    const newTypeRef = doc(this.typesRef(accountId));
    return setDoc(newTypeRef, payload).then(() => newTypeRef.id);
  }

  updateDividendType(accountId: string, id: string, changes: Partial<DividendType>): Promise<void> {
    this.requireAuth();

    const payload = stripUndefined({
      ...changes,
      name: changes.name?.trim(),
      description: changes.description?.trim(),
    }) as UpdateData<DividendType>;

    return updateDoc(doc(this.firestore, 'accounts', accountId, 'dividend-types', id), payload);
  }

  deleteDividendType(accountId: string, id: string): Promise<void> {
    this.requireAuth();
    return deleteDoc(doc(this.firestore, 'accounts', accountId, 'dividend-types', id));
  }
}