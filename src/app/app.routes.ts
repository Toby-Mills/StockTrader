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
    path: 'accounts/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/accounts/account-details.component').then(m => m.AccountDetailsComponent),
  },
  {
    path: 'accounts',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/accounts/accounts.component').then(m => m.AccountsComponent),
  },
  {
    path: 'portfolio',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/portfolio/portfolio.component').then(m => m.PortfolioComponent),
  },
  {
    path: 'transactions',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/transactions/transactions.component').then(m => m.TransactionsComponent),
  },
  {
    path: 'dividends',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dividends/dividends.component').then(m => m.DividendsComponent),
  },
  {
    path: 'analytics',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent),
  },
  { path: '**', redirectTo: '/portfolio' },
];
