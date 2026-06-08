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
  where,
  getDocs,
  limit,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { AccountSnapshot } from '../models/account-snapshot.model';
import { AuthService } from './auth.service';
import { stripUndefined } from '../utils/strip-undefined';
import { sortByDateAndCreatedAt } from '../utils/record-sort';

@Injectable({ providedIn: 'root' })
export class AccountHistoryService {
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);

  private requireAuth(): void {
    this.authService.requireUserUid();
  }

  private snapshotsRef(accountId: string) {
    this.requireAuth();
    return collection(this.firestore, 'accounts', accountId, 'snapshots');
  }

  getSnapshots(accountId: string): Observable<AccountSnapshot[]> {
    const q = query(this.snapshotsRef(accountId), orderBy('date', 'desc'));
    return (collectionData(q, { idField: 'id' }) as Observable<AccountSnapshot[]>)
      .pipe(map(snapshots => sortByDateAndCreatedAt(snapshots)));
  }

  async addOrUpdateSnapshot(accountId: string, snapshot: Partial<AccountSnapshot> & { date: Date, stockValue: number }): Promise<void> {
    const snapshotsRef = this.snapshotsRef(accountId);

    // If we have an ID, update that specific document directly
    if (snapshot.id) {
      const { id, ...data } = snapshot;
      await updateDoc(doc(this.firestore, 'accounts', accountId, 'snapshots', id), stripUndefined(data) as any);
      return;
    }

    const startOfDay = new Date(snapshot.date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(snapshot.date);
    endOfDay.setHours(23, 59, 59, 999);

    const q = query(
      snapshotsRef,
      where('date', '>=', startOfDay),
      where('date', '<=', endOfDay),
      limit(1)
    );

    const existing = await getDocs(q);
    if (!existing.empty) {
      const existingId = existing.docs[0].id;
      const payload = stripUndefined({
        ...snapshot,
      }) as UpdateData<AccountSnapshot>;
      await updateDoc(doc(this.firestore, 'accounts', accountId, 'snapshots', existingId), payload);
    } else {
      await addDoc(snapshotsRef, stripUndefined({
        ...snapshot,
        createdAt: serverTimestamp(),
      }));
    }
  }

  deleteSnapshot(accountId: string, id: string): Promise<void> {
    this.requireAuth();
    return deleteDoc(doc(this.firestore, 'accounts', accountId, 'snapshots', id));
  }
}
