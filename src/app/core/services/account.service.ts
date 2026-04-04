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
  getDocs,
  limit,
  serverTimestamp,
  query,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Account } from '../models/account.model';
import { AuthService } from './auth.service';
import { stripUndefined } from '../utils/strip-undefined';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);

  private currentUid(): string {
    return this.authService.requireUserUid();
  }

  private accountsRef() {
    this.currentUid();
    return collection(this.firestore, 'accounts');
  }

  getAccounts(): Observable<Account[]> {
    const ref = this.accountsRef();
    const q = query(ref, where('ownerUid', '==', this.currentUid()));
    return collectionData(q, { idField: 'id' }) as Observable<Account[]>;
  }

  addAccount(account: Omit<Account, 'id' | 'ownerUid' | 'createdAt'>): Promise<void> {
    const ownerUid = this.currentUid();
    const ref = this.accountsRef();
    const payload = stripUndefined({
      ...account,
      ownerUid,
      createdAt: serverTimestamp(),
    });
    return addDoc(ref, payload).then(() => undefined);
  }

  updateAccount(id: string, changes: Partial<Omit<Account, 'id' | 'ownerUid' | 'createdAt'>>): Promise<void> {
    this.currentUid();
    const payload = stripUndefined(changes) as UpdateData<Omit<Account, 'id'>>;
    return updateDoc(doc(this.firestore, 'accounts', id), payload);
  }

  deleteAccount(id: string): Promise<void> {
    this.currentUid();
    return this.deleteAccountWithChildren(id);
  }

  private async deleteAccountWithChildren(accountId: string): Promise<void> {
    const accountSubcollections = [
      'transactions',
      'dividends',
      'dividend-types',
      'cash-events',
      'symbols',
    ];

    for (const subcollection of accountSubcollections) {
      await this.deleteSubcollectionDocs(accountId, subcollection);
    }

    await deleteDoc(doc(this.firestore, 'accounts', accountId));
  }

  private async deleteSubcollectionDocs(accountId: string, subcollection: string): Promise<void> {
    const batchLimit = 400;
    const subcollectionRef = collection(this.firestore, 'accounts', accountId, subcollection);

    while (true) {
      const snapshot = await getDocs(query(subcollectionRef, limit(batchLimit)));
      if (snapshot.empty) {
        return;
      }

      const batch = writeBatch(this.firestore);
      for (const record of snapshot.docs) {
        batch.delete(record.ref);
      }
      await batch.commit();

      if (snapshot.size < batchLimit) {
        return;
      }
    }
  }
}
