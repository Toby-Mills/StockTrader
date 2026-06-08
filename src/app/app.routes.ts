import { Routes } from '@angular/router';
import {
  authGuard,
  signedOutGuard,
} from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/portfolio', pathMatch: 'full' },
  {
    path: 'sign-in',
    canActivate: [signedOutGuard],
    loadComponent: () =>
      import('./features/auth/sign-in.component').then(m => m.SignInComponent),
  },
  {
    path: 'accounts/manage',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/accounts/accounts.component').then(m => m.AccountsComponent),
  },
  {
    path: 'accounts/:id/activity',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/activity/activity.component').then(m => m.ActivityComponent),
  },
  {
    path: 'accounts',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/activity/activity.component').then(m => m.ActivityComponent),
  },
  {
    path: 'portfolio',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/portfolio/portfolio.component').then(m => m.PortfolioComponent),
  },
  {
    path: 'analytics',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent),
  },
  {
    path: 'accounts/:id/analytics',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent),
  },
  {
    path: 'stock-prices',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/symbols/symbols.component').then(m => m.SymbolsComponent),
  },
  {
    path: 'accounts/:id/stock-prices',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/symbols/symbols.component').then(m => m.SymbolsComponent),
  },
  { path: '**', redirectTo: '/portfolio' },
];
