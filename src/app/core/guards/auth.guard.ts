import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

const checkAuth = (returnUrl: string) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const redirectTree: UrlTree = router.createUrlTree(['/sign-in'], {
    queryParams: { returnUrl },
  });

  return authService.user$.pipe(
    take(1),
    map(user => (user ? true : redirectTree))
  );
};

export const authGuard: CanActivateFn = (_route, state) => checkAuth(state.url);

const checkSignedOut = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const signedInRedirectTree: UrlTree = router.createUrlTree(['/portfolio']);

  return authService.user$.pipe(
    take(1),
    map(user => (user ? signedInRedirectTree : true))
  );
};

export const signedOutGuard: CanActivateFn = () => checkSignedOut();
