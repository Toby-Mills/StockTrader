/**
 * StockTrader project scaffolding script.
 * Run once with: node setup.js
 * Creates the full src/ directory structure, source files, and .github/copilot-instructions.md.
 */

const fs = require('fs');
const path = require('path');

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(filePath, content) {
  mkdir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  created: ${filePath}`);
}

console.log('\nScaffolding StockTrader...\n');

// ── Environments ──────────────────────────────────────────────────────────────

write('src/environments/environment.template.ts', `// Copy this file to environment.ts and environment.prod.ts and fill in your Firebase project values.
// Do NOT commit environment.ts or environment.prod.ts (they are gitignored).
export const environment = {
  production: false,
  firebase: {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
  },
};
`);

write('src/environments/environment.ts', `export const environment = {
  production: false,
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
};
`);

write('src/environments/environment.prod.ts', `export const environment = {
  production: true,
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
};
`);

// ── src/ root files ───────────────────────────────────────────────────────────

write('src/index.html', `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>StockTrader</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</head>
<body class="mat-typography">
  <app-root></app-root>
</body>
</html>
`);

write('src/main.ts', `import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
`);

write('src/styles.scss', `@use '@angular/material' as mat;

@include mat.core();

$primary: mat.define-palette(mat.$indigo-palette);
$accent:  mat.define-palette(mat.$pink-palette, A200, A100, A400);
$warn:    mat.define-palette(mat.$red-palette);

$theme: mat.define-light-theme((
  color: (primary: $primary, accent: $accent, warn: $warn),
  typography: mat.define-typography-config(),
  density: 0,
));

@include mat.all-component-themes($theme);

* { box-sizing: border-box; }

html, body {
  height: 100%;
  margin: 0;
  font-family: Roboto, 'Helvetica Neue', sans-serif;
}
`);

// ── App bootstrap ─────────────────────────────────────────────────────────────

write('src/app/app.config.ts', `import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { routes } from './app.routes';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimations(),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideFirestore(() => getFirestore()),
  ],
};
`);

write('src/app/app.routes.ts', `import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: '/portfolio', pathMatch: 'full' },
  {
    path: 'accounts',
    loadComponent: () =>
      import('./features/accounts/accounts.component').then(m => m.AccountsComponent),
  },
  {
    path: 'portfolio',
    loadComponent: () =>
      import('./features/portfolio/portfolio.component').then(m => m.PortfolioComponent),
  },
  {
    path: 'transactions',
    loadComponent: () =>
      import('./features/transactions/transactions.component').then(m => m.TransactionsComponent),
  },
  {
    path: 'dividends',
    loadComponent: () =>
      import('./features/dividends/dividends.component').then(m => m.DividendsComponent),
  },
  {
    path: 'analytics',
    loadComponent: () =>
      import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent),
  },
];
`);

write('src/app/app.component.ts', `import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'StockTrader';

  navItems = [
    { label: 'Portfolio',     icon: 'show_chart',    route: '/portfolio' },
    { label: 'Accounts',      icon: 'account_balance', route: '/accounts' },
    { label: 'Transactions',  icon: 'swap_horiz',    route: '/transactions' },
    { label: 'Dividends',     icon: 'payments',      route: '/dividends' },
    { label: 'Analytics',     icon: 'analytics',     route: '/analytics' },
  ];
}
`);

write('src/app/app.component.html', `<mat-toolbar color="primary">
  <span>{{ title }}</span>
</mat-toolbar>

<mat-sidenav-container class="sidenav-container">
  <mat-sidenav mode="side" opened class="sidenav">
    <mat-nav-list>
      @for (item of navItems; track item.route) {
        <a mat-list-item [routerLink]="item.route" routerLinkActive="active-link">
          <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
          <span matListItemTitle>{{ item.label }}</span>
        </a>
      }
    </mat-nav-list>
  </mat-sidenav>

  <mat-sidenav-content class="content">
    <router-outlet />
  </mat-sidenav-content>
</mat-sidenav-container>
`);

write('src/app/app.component.scss', `.sidenav-container {
  height: calc(100vh - 64px);
}

.sidenav {
  width: 220px;
}

.content {
  padding: 24px;
}

.active-link {
  background-color: rgba(0, 0, 0, 0.08);
}
`);

// ── Core models ───────────────────────────────────────────────────────────────

write('src/app/core/models/account.model.ts', `export interface Account {
  id: string;
  name: string;
  currency: string;  // e.g. 'GBP', 'USD'
  broker?: string;
  description?: string;
  createdAt: Date;
}
`);

write('src/app/core/models/transaction.model.ts', `export type TransactionType = 'buy' | 'sell';

export interface Transaction {
  id: string;
  accountId: string;
  symbol: string;      // e.g. 'AAPL', 'VOD.L'
  type: TransactionType;
  date: Date;
  quantity: number;
  price: number;
  currency: string;
  fees?: number;
  notes?: string;
}
`);

write('src/app/core/models/dividend.model.ts', `export interface Dividend {
  id: string;
  accountId: string;
  symbol: string;
  date: Date;
  amount: number;
  currency: string;
  sharesHeld?: number;
  notes?: string;
}
`);

write('src/app/core/models/holding.model.ts', `/** Computed (not stored) — derived from transactions for a given symbol in an account. */
export interface Holding {
  symbol: string;
  accountId: string;
  quantity: number;
  averageCost: number;
  totalCost: number;
  currency: string;
  // Populated when live prices are available
  currentPrice?: number;
  currentValue?: number;
  gainLoss?: number;
  gainLossPercent?: number;
  totalDividends?: number;
}
`);

// ── Core services ─────────────────────────────────────────────────────────────

write('src/app/core/services/account.service.ts', `import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Account } from '../models/account.model';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private firestore = inject(Firestore);

  getAccounts(): Observable<Account[]> {
    const ref = collection(this.firestore, 'accounts');
    return collectionData(ref, { idField: 'id' }) as Observable<Account[]>;
  }

  addAccount(account: Omit<Account, 'id' | 'createdAt'>): Promise<void> {
    const ref = collection(this.firestore, 'accounts');
    return addDoc(ref, { ...account, createdAt: serverTimestamp() }).then(() => undefined);
  }

  updateAccount(id: string, changes: Partial<Omit<Account, 'id'>>): Promise<void> {
    return updateDoc(doc(this.firestore, 'accounts', id), changes as Record<string, unknown>);
  }

  deleteAccount(id: string): Promise<void> {
    return deleteDoc(doc(this.firestore, 'accounts', id));
  }
}
`);

write('src/app/core/services/transaction.service.ts', `import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Transaction } from '../models/transaction.model';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private firestore = inject(Firestore);

  private txRef(accountId: string) {
    return collection(this.firestore, 'accounts', accountId, 'transactions');
  }

  getTransactions(accountId: string): Observable<Transaction[]> {
    const q = query(this.txRef(accountId), orderBy('date', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<Transaction[]>;
  }

  getTransactionsForSymbol(accountId: string, symbol: string): Observable<Transaction[]> {
    const q = query(this.txRef(accountId), where('symbol', '==', symbol), orderBy('date', 'asc'));
    return collectionData(q, { idField: 'id' }) as Observable<Transaction[]>;
  }

  addTransaction(accountId: string, tx: Omit<Transaction, 'id' | 'accountId'>): Promise<void> {
    return addDoc(this.txRef(accountId), { ...tx, accountId }).then(() => undefined);
  }

  updateTransaction(accountId: string, id: string, changes: Partial<Transaction>): Promise<void> {
    return updateDoc(doc(this.firestore, 'accounts', accountId, 'transactions', id), changes as Record<string, unknown>);
  }

  deleteTransaction(accountId: string, id: string): Promise<void> {
    return deleteDoc(doc(this.firestore, 'accounts', accountId, 'transactions', id));
  }
}
`);

write('src/app/core/services/dividend.service.ts', `import { Injectable, inject } from '@angular/core';
import {
  Firestore,
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

@Injectable({ providedIn: 'root' })
export class DividendService {
  private firestore = inject(Firestore);

  private divRef(accountId: string) {
    return collection(this.firestore, 'accounts', accountId, 'dividends');
  }

  getDividends(accountId: string): Observable<Dividend[]> {
    const q = query(this.divRef(accountId), orderBy('date', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<Dividend[]>;
  }

  addDividend(accountId: string, div: Omit<Dividend, 'id' | 'accountId'>): Promise<void> {
    return addDoc(this.divRef(accountId), { ...div, accountId }).then(() => undefined);
  }

  updateDividend(accountId: string, id: string, changes: Partial<Dividend>): Promise<void> {
    return updateDoc(doc(this.firestore, 'accounts', accountId, 'dividends', id), changes as Record<string, unknown>);
  }

  deleteDividend(accountId: string, id: string): Promise<void> {
    return deleteDoc(doc(this.firestore, 'accounts', accountId, 'dividends', id));
  }
}
`);

write('src/app/core/services/portfolio.service.ts', `import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { TransactionService } from './transaction.service';
import { DividendService } from './dividend.service';
import { Transaction } from '../models/transaction.model';
import { Holding } from '../models/holding.model';

@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private transactionService = inject(TransactionService);
  private dividendService = inject(DividendService);

  /** Compute current holdings from the full transaction history for one account. */
  getHoldings(accountId: string): Observable<Holding[]> {
    return combineLatest([
      this.transactionService.getTransactions(accountId),
      this.dividendService.getDividends(accountId),
    ]).pipe(
      map(([transactions, dividends]) =>
        this.computeHoldings(accountId, transactions, dividends.reduce((acc, d) => {
          acc[d.symbol] = (acc[d.symbol] ?? 0) + d.amount;
          return acc;
        }, {} as Record<string, number>))
      )
    );
  }

  private computeHoldings(
    accountId: string,
    transactions: Transaction[],
    dividendsBySymbol: Record<string, number>
  ): Holding[] {
    const map = new Map<string, { qty: number; cost: number; currency: string }>();

    // Process transactions chronologically (oldest first)
    [...transactions].reverse().forEach(tx => {
      const existing = map.get(tx.symbol) ?? { qty: 0, cost: 0, currency: tx.currency };
      if (tx.type === 'buy') {
        existing.cost += tx.quantity * tx.price + (tx.fees ?? 0);
        existing.qty  += tx.quantity;
      } else {
        const avgCost = existing.qty > 0 ? existing.cost / existing.qty : 0;
        existing.cost -= avgCost * tx.quantity;
        existing.qty  -= tx.quantity;
      }
      if (existing.qty > 0) map.set(tx.symbol, existing);
      else map.delete(tx.symbol);
    });

    return Array.from(map.entries()).map(([symbol, { qty, cost, currency }]) => ({
      symbol,
      accountId,
      quantity: qty,
      averageCost: qty > 0 ? cost / qty : 0,
      totalCost: cost,
      currency,
      totalDividends: dividendsBySymbol[symbol] ?? 0,
    }));
  }
}
`);

// ── Feature components (stubs) ────────────────────────────────────────────────

function featureComponent(name, selector, title) {
  return `import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: '${selector}',
  standalone: true,
  imports: [MatCardModule],
  templateUrl: './${name}.component.html',
  styleUrl: './${name}.component.scss',
})
export class ${title}Component {}
`;
}

function featureTemplate(title) {
  return `<mat-card>
  <mat-card-header>
    <mat-card-title>${title}</mat-card-title>
  </mat-card-header>
  <mat-card-content>
    <p>${title} — coming soon.</p>
  </mat-card-content>
</mat-card>
`;
}

const features = [
  ['accounts',     'app-accounts',     'Accounts'],
  ['portfolio',    'app-portfolio',    'Portfolio'],
  ['transactions', 'app-transactions', 'Transactions'],
  ['dividends',    'app-dividends',    'Dividends'],
  ['analytics',    'app-analytics',    'Analytics'],
];

for (const [name, selector, title] of features) {
  write(`src/app/features/${name}/${name}.component.ts`,   featureComponent(name, selector, title));
  write(`src/app/features/${name}/${name}.component.html`, featureTemplate(title));
  write(`src/app/features/${name}/${name}.component.scss`, `// ${title} styles\n`);
}

// ── .github/copilot-instructions.md ──────────────────────────────────────────

write('.github/copilot-instructions.md', `# StockTrader — Copilot Instructions

## Commands

| Task | Command |
|---|---|
| Dev server (http://localhost:4200) | \`npm start\` |
| Production build | \`npm run build:prod\` |
| Run all tests | \`npm test\` |
| Run a single test file | \`ng test --include='src/app/path/to/file.spec.ts'\` |
| Generate a standalone component | \`ng generate component features/my-feature/my-feature\` |

After cloning, install dependencies first: \`npm install\`

## Architecture

Angular 17+ standalone component application. No backend — all data is stored in **Firebase Firestore** via **@angular/fire**.

### Firestore Data Structure

\`\`\`
accounts/{accountId}                  ← Account metadata
accounts/{accountId}/transactions/{id} ← Buy/sell records
accounts/{accountId}/dividends/{id}    ← Dividend payments
\`\`\`

Holdings are **not stored** — they are computed in \`PortfolioService\` by replaying transaction history (average cost basis).

### Folder Structure

\`\`\`
src/app/
  core/
    models/       ← Domain interfaces (Account, Transaction, Dividend, Holding)
    services/     ← Firestore CRUD services + PortfolioService
  features/       ← One folder per route (accounts, portfolio, transactions, dividends, analytics)
  shared/         ← Reusable components, pipes, directives
\`\`\`

## Key Conventions

### Standalone Components

All components use \`standalone: true\` — no NgModules. Import Angular Material modules and directives directly in each component's \`imports: []\` array.

### Signals vs Observables

- Firestore services return \`Observable<T>\` (AngularFire pattern).
- Convert to signals in components with \`toSignal()\` from \`@angular/core/rxjs-interop\`.
- Local component state uses \`signal()\` / \`computed()\`.
- Avoid subscribing manually; prefer \`toSignal()\` or the \`async\` pipe.

### Firebase Configuration

Firebase credentials go in \`src/environments/environment.ts\` and \`environment.prod.ts\`, which are **gitignored**.
Copy \`src/environments/environment.template.ts\`, fill in values from the Firebase console, and save as \`environment.ts\`.

### Multiple Accounts

Each \`Account\` has a \`currency\` field (e.g. \`'GBP'\`, \`'USD'\`). Transactions and dividends are always stored in their account's currency. Do **not** mix currencies in aggregate calculations without explicit conversion.

### Services Pattern

Services in \`core/services/\` use \`inject()\` (not constructor injection). They return \`Observable<T>\` from Firestore. Computed data that spans multiple collections lives in dedicated services (e.g. \`PortfolioService\` combines transactions + dividends).

### Angular Material

Angular Material is the UI component library. Use the \`mat-\` prefix components. The global theme is defined in \`src/styles.scss\` — avoid per-component theme overrides.
`);

console.log('\n✅ Done! Next steps:');
console.log('  1. npm install');
console.log('  2. Copy src/environments/environment.template.ts → environment.ts and fill in Firebase values');
console.log('  3. npm start\n');
