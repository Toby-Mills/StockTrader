import { ApplicationConfig } from '@angular/core';
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { getApp, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { initializeFirestore, provideFirestore } from '@angular/fire/firestore';
import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { appDateProviders } from './core/utils/app-date-format';

const DYNAMIC_IMPORT_RELOAD_GUARD_KEY = 'dynamic-import-reload-attempted';

function isDynamicImportFetchFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('error loading dynamically imported module')
  );
}

function handleNavigationError(error: unknown): void {
  if (!isDynamicImportFetchFailure(error)) {
    return;
  }

  const hasReloaded = sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_GUARD_KEY) === '1';
  if (hasReloaded) {
    sessionStorage.removeItem(DYNAMIC_IMPORT_RELOAD_GUARD_KEY);
    return;
  }

  sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_GUARD_KEY, '1');
  location.reload();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withNavigationErrorHandler(handleNavigationError)),
    provideAnimations(),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    ...appDateProviders,
    provideFirestore(() =>
      initializeFirestore(getApp(), {
        experimentalForceLongPolling: true,
      })
    ),
  ],
};
