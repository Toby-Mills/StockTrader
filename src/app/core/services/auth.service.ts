import { Injectable, inject } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  User,
  authState,
  signInWithPopup,
  signOut,
} from '@angular/fire/auth';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly provider = new GoogleAuthProvider();

  readonly user$: Observable<User | null> = authState(this.auth);

  get currentUser(): User | null {
    return this.auth.currentUser;
  }

  async signInWithGoogle(): Promise<void> {
    await signInWithPopup(this.auth, this.provider);
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
  }

  requireUserUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('You must be signed in to access Firestore data.');
    }
    return uid;
  }
}
