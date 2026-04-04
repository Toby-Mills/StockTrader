# StockTrader — Copilot Instructions

## Commands

| Task | Command |
|---|---|
| Dev server (http://localhost:4200) | `npm start` |
| Production build | `npm run build:prod` |
| Run all tests | `npm test` |
| Run a single test file | `ng test --include='src/app/path/to/file.spec.ts'` |
| Deploy Firestore rules | `npm run deploy:rules` |
| Generate a standalone component | `ng generate component features/my-feature/my-feature` |

After cloning, install dependencies first: `npm install`

## Architecture

Angular 17+ standalone component application. No backend — all data is stored in **Firebase Firestore** via **@angular/fire**.

### Firestore Data Structure

```
accounts/{accountId}                  ← Account metadata
accounts/{accountId}/transactions/{id} ← Buy/sell records
accounts/{accountId}/dividends/{id}    ← Dividend payments
accounts/{accountId}/dividend-types/{id} ← Account-specific dividend type catalog (e.g. Cash, Special)
accounts/{accountId}/cash-events/{id}  ← Deposits/withdrawals for account cash ledger
accounts/{accountId}/symbols/{id}      ← Tracked ticker symbols and display names
```

Holdings and cash balance are **not stored** — they are computed in `PortfolioService` by replaying transactions, dividends, and cash events.

### Folder Structure

```
src/app/
  core/
    models/       ← Domain interfaces (Account, Transaction, Dividend, DividendType, CashEvent, TrackedSymbol, Holding)
    services/     ← Firestore CRUD services + aggregate services (PortfolioService, FinancialCalculationsService)
  features/       ← Route features (accounts, portfolio, transactions, dividends, symbols, analytics)
  shared/         ← Reusable components, pipes, directives
```

## Key Conventions

### Standalone Components

All components use `standalone: true` — no NgModules. Import Angular Material modules and directives directly in each component's `imports: []` array.

### Signals vs Observables

- Firestore services return `Observable<T>` (AngularFire pattern).
- Convert to signals in components with `toSignal()` from `@angular/core/rxjs-interop`.
- Local component state uses `signal()` / `computed()`.
- Avoid subscribing manually; prefer `toSignal()` or the `async` pipe.

### Firebase Configuration

Firebase credentials go in `src/environments/environment.ts` and `environment.prod.ts`, which are **gitignored**.
Copy `src/environments/environment.template.ts`, fill in values from the Firebase console, and save as `environment.ts`.

### Firestore Rules

Security rules are defined in the repository root `firestore.rules` file.
When rules change, deploy them with `npm run deploy:rules` (script: `firebase deploy --only firestore:rules`).

### Multiple Accounts

Each `Account` has a `currency` field (e.g. `'GBP'`, `'USD'`). Transactions and dividends are always stored in their account's currency. Do **not** mix currencies in aggregate calculations without explicit conversion.

Cash events are also account-scoped and currency-specific. Keep each cash event in the same currency as its parent account.

### Services Pattern

Services in `core/services/` use `inject()` (not constructor injection). They return `Observable<T>` from Firestore. Computed data that spans multiple collections lives in dedicated services (e.g. `PortfolioService` combines transactions + dividends).

For symbols, cash events, and dividend types:

- `SymbolCatalogService` stores symbols under `accounts/{accountId}/symbols`, normalizes symbol codes to uppercase, and trims display names.
- `CashEventService` stores entries under `accounts/{accountId}/cash-events` with `type: 'deposit' | 'withdrawal'` and `createdAt` server timestamps.
- `DividendTypeService` stores entries under `accounts/{accountId}/dividend-types`, trims type names/descriptions, and is account-scoped.
- `PortfolioService` computes cash balance by replaying transactions, dividends, and cash events in chronological order (using `createdAt` as a tie-breaker when available).

For dividend entry UX:

- In `DividendDialogComponent`, the dividend type field should support selecting existing types and free-text entry in the same control.
- If the entered type does not exist, create it under `accounts/{accountId}/dividend-types` during save, then persist the dividend with the created `dividendTypeId`.

### Angular Material

Angular Material is the UI component library. Use the `mat-` prefix components. The global theme is defined in `src/styles.scss` — avoid per-component theme overrides.
