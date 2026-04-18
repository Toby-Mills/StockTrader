import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { Account } from '../../core/models/account.model';
import { CashEvent, CashEventType } from '../../core/models/cash-event.model';
import { Dividend } from '../../core/models/dividend.model';
import { DividendType } from '../../core/models/dividend-type.model';
import { TrackedSymbol } from '../../core/models/tracked-symbol.model';
import { Transaction, TransactionType } from '../../core/models/transaction.model';
import { AccountService } from '../../core/services/account.service';
import { CashEventService } from '../../core/services/cash-event.service';
import { DividendService } from '../../core/services/dividend.service';
import { DividendTypeService } from '../../core/services/dividend-type.service';
import { PortfolioService } from '../../core/services/portfolio.service';
import { SymbolCatalogService } from '../../core/services/symbol-catalog.service';
import { TransactionService } from '../../core/services/transaction.service';
import { sortByDateAndCreatedAt } from '../../core/utils/record-sort';
import { CashEventDialogComponent, CashEventDialogResult } from './cash-event-dialog.component';
import { AccountDeleteConfirmDialogComponent } from './account-delete-confirm-dialog.component';
import { DividendDialogComponent, DividendDialogResult } from '../dividends/dividend-dialog.component';
import { SymbolDialogComponent, SymbolDialogResult } from '../symbols/symbol-dialog.component';
import { TransactionDialogComponent, TransactionDialogResult } from '../transactions/transaction-dialog.component';

interface CashLedgerRow {
  id: string;
  date: unknown;
  createdAt?: unknown;
  source: 'cash-event' | 'dividend' | 'transaction';
  sourceLabel: string;
  details: string;
  amount: number;
  currency: string;
  notes?: string;
  cashEvent?: CashEvent;
}

type CsvTransactionKind = 'Purchase' | 'Sell' | 'Sale' | 'Dividend' | 'Foreign Dividends' | 'REIT Distribution';

interface ParsedCsvRow {
  rowNumber: number;
  date: Date;
  ticker: string;
  name: string;
  transaction: CsvTransactionKind;
  cost?: number;
  shares?: number;
  pricePerShare?: number;
  fees?: number;
}

@Component({
  selector: 'app-account-details',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatDialogModule,
    MatTabsModule,
  ],
  templateUrl: './account-details.component.html',
  styleUrl: './account-details.component.scss',
})
export class AccountDetailsComponent {
  private static readonly CSV_DIVIDEND_TYPES: readonly CsvTransactionKind[] = [
    'Dividend',
    'Foreign Dividends',
    'REIT Distribution',
  ];

  private static readonly CSV_TRANSACTION_TYPES: readonly CsvTransactionKind[] = [
    'Purchase',
    'Sell',
    'Sale',
    ...AccountDetailsComponent.CSV_DIVIDEND_TYPES,
  ];

  private static readonly CSV_HEADER_LINES = 2;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountService = inject(AccountService);
  private readonly transactionService = inject(TransactionService);
  private readonly dividendService = inject(DividendService);
  private readonly dividendTypeService = inject(DividendTypeService);
  private readonly cashEventService = inject(CashEventService);
  private readonly portfolioService = inject(PortfolioService);
  private readonly symbolCatalogService = inject(SymbolCatalogService);
  private readonly dialog = inject(MatDialog);

  readonly accountId = signal<string | null>(null);
  readonly account = signal<Account | null>(null);
  readonly transactions = signal<Transaction[]>([]);
  readonly dividends = signal<Dividend[]>([]);
  readonly dividendTypes = signal<DividendType[]>([]);
  readonly cashEvents = signal<CashEvent[]>([]);
  readonly cashBalance = signal(0);
  readonly trackedSymbols = signal<TrackedSymbol[]>([]);
  readonly selectedSymbol = signal('ALL');

  readonly isCashNegative = computed(() => this.cashBalance() < 0);

  readonly symbols = computed(() =>
    [...new Set([
      ...this.trackedSymbols().map(symbol => symbol.symbol.toUpperCase()),
      ...this.transactions().flatMap(tx => {
        const fromSymbol = this.normalizeSymbol(tx.symbol);
        const toSymbol = tx.type === 'swap' ? this.normalizeSymbol(tx.toSymbol) : null;
        return toSymbol ? [fromSymbol, toSymbol] : [fromSymbol];
      }),
      ...this.dividends().map(div => div.symbol.toUpperCase()),
    ])].sort((a, b) => a.localeCompare(b))
  );

  readonly filteredTransactions = computed(() => {
    const symbol = this.selectedSymbol();
    const txList = [...this.transactions()];
    if (symbol === 'ALL') {
      return txList;
    }
    return txList.filter(tx => this.transactionInvolvesSymbol(tx, symbol));
  });

  readonly filteredDividends = computed(() => {
    const symbol = this.selectedSymbol();
    const list = [...this.dividends()];
    if (symbol === 'ALL') {
      return list;
    }
    return list.filter(div => div.symbol.toUpperCase() === symbol);
  });

  readonly filteredSymbolSummary = computed(() => {
    const symbol = this.selectedSymbol();
    if (symbol === 'ALL') {
      return null;
    }

    const txList = this.filteredTransactions();

    const purchaseValue = txList
      .filter(tx => tx.type === 'buy')
      .reduce((sum, tx) => sum + this.totalCost(tx), 0);

    const swapFeeOutflow = txList
      .filter(tx => this.isSwapOutForSelectedSymbol(tx, symbol))
      .reduce((sum, tx) => sum + (tx.fees ?? 0), 0);

    const saleValue = txList
      .filter(tx => tx.type === 'sell')
      .reduce((sum, tx) => sum + this.totalCost(tx), 0);

    const totalDividends = this.filteredDividends()
      .reduce((sum, div) => sum + div.amount, 0);

    const currentPosition = txList.reduce((position, tx) =>
      position + this.shareDeltaForSelection(tx, symbol),
    0);

    const netCash = saleValue + totalDividends - purchaseValue - swapFeeOutflow;

    return {
      symbol,
      purchaseValue,
      swapFeeOutflow,
      saleValue,
      totalDividends,
      currentPosition,
      netCash,
    };
  });

  readonly symbolNameByCode = computed(() => {
    const lookup = new Map<string, string>();
    for (const symbol of this.trackedSymbols()) {
      lookup.set(symbol.symbol.trim().toUpperCase(), symbol.fullName);
    }
    return lookup;
  });

  readonly dividendTypeNameById = computed(() => {
    const lookup = new Map<string, string>();
    for (const type of this.dividendTypes()) {
      lookup.set(type.id, type.name);
    }
    return lookup;
  });

  readonly cashLedgerRows = computed(() => {
    const rows: CashLedgerRow[] = [];
    const symbol = this.selectedSymbol();

    if (symbol === 'ALL') {
      for (const event of this.cashEvents()) {
        rows.push({
          id: `cash-event-${event.id}`,
          date: event.date,
          createdAt: event.createdAt,
          source: 'cash-event',
          sourceLabel: this.cashEventLabel(event.type),
          details: event.type === 'deposit' ? 'Account funding' : 'Cash withdrawal',
          amount: this.cashAmountSigned(event),
          currency: event.currency,
          notes: event.notes,
          cashEvent: event,
        });
      }
    }

    for (const dividend of this.filteredDividends()) {
      rows.push({
        id: `dividend-${dividend.id}`,
        date: dividend.date,
        createdAt: dividend.createdAt,
        source: 'dividend',
        sourceLabel: 'Dividend',
        details: this.symbolLabel(dividend.symbol),
        amount: dividend.amount,
        currency: dividend.currency,
        notes: dividend.notes,
      });
    }

    for (const tx of this.filteredTransactions()) {
      const amount = this.cashDeltaForSelection(tx, symbol);
      const fees = tx.fees ?? 0;

      rows.push({
        id: `transaction-${tx.id}`,
        date: tx.date,
        createdAt: tx.createdAt,
        source: 'transaction',
        sourceLabel: this.transactionLabelForSelection(tx, symbol),
        details: this.transactionDetailsForSelection(tx, symbol),
        amount,
        currency: tx.currency,
        notes: fees > 0 ? `Fees: ${this.formatNumber(fees)}` : undefined,
      });
    }

    return sortByDateAndCreatedAt(rows);
  });

  isSaving = false;
  feedbackMessage = '';

  private debug(message: string, data?: unknown): void {
    if (data === undefined) {
      console.debug('[AccountDetails]', message);
      return;
    }
    console.debug('[AccountDetails]', message, data);
  }

  constructor() {
    effect(onCleanup => {
      this.debug('Subscribing to route paramMap');
      const subscription = this.route.paramMap.subscribe(paramMap => {
        const id = paramMap.get('id');
        this.debug('Route param id received', { id, url: this.router.url });
        this.accountId.set(id);
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });

    effect(onCleanup => {
      const id = this.accountId();
      this.debug('Account effect triggered', { id });

      if (!id) {
        this.debug('No account id yet, keeping account as null');
        this.account.set(null);
        return;
      }

      this.debug('Subscribing to accounts stream', { id });
      const subscription = this.accountService.getAccounts().subscribe({
        next: accounts => {
          const found = accounts.find(account => account.id === id) ?? null;
          this.debug('Accounts stream emitted', {
            requestedId: id,
            count: accounts.length,
            found: !!found,
            sampleIds: accounts.slice(0, 5).map(account => account.id),
          });
          this.account.set(found);

          if (!found) {
            this.debug('Requested account id not found, navigating back to /accounts', { id });
            this.router.navigate(['/accounts']);
          }
        },
        error: error => {
          this.debug('Accounts stream error', error);
          this.feedbackMessage = this.errorMessage(error, 'Could not load account');
        },
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });

    effect(onCleanup => {
      const id = this.accountId();
      if (!id) {
        this.debug('No account id for transactions stream, clearing list');
        this.transactions.set([]);
        return;
      }

      this.debug('Subscribing to transactions stream', { id });
      const subscription = this.transactionService.getTransactions(id).subscribe({
        next: txList => {
          this.debug('Transactions stream emitted', { id, count: txList.length });
          this.transactions.set(txList);
        },
        error: error => {
          this.debug('Transactions stream error', error);
          this.feedbackMessage = this.errorMessage(error, 'Could not load transactions');
        },
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });

    effect(onCleanup => {
      const id = this.accountId();
      if (!id) {
        this.debug('No account id for dividends stream, clearing list');
        this.dividends.set([]);
        return;
      }

      this.debug('Subscribing to dividends stream', { id });
      const subscription = this.dividendService.getDividends(id).subscribe({
        next: divList => {
          this.debug('Dividends stream emitted', { id, count: divList.length });
          this.dividends.set(divList);
        },
        error: error => {
          this.debug('Dividends stream error', error);
          this.feedbackMessage = this.errorMessage(error, 'Could not load dividends');
        },
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });

    effect(onCleanup => {
      const id = this.accountId();
      if (!id) {
        this.debug('No account id for dividend types stream, clearing list');
        this.dividendTypes.set([]);
        return;
      }

      this.debug('Subscribing to dividend types stream', { id });
      const subscription = this.dividendTypeService.getDividendTypes(id).subscribe({
        next: types => {
          this.debug('Dividend types stream emitted', { id, count: types.length });
          this.dividendTypes.set([...types].sort((a, b) => a.name.localeCompare(b.name)));
        },
        error: error => {
          this.debug('Dividend types stream error', error);
          this.feedbackMessage = this.errorMessage(error, 'Could not load dividend types');
        },
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });

    effect(onCleanup => {
      const id = this.accountId();
      if (!id) {
        this.debug('No account id for cash events stream, clearing list');
        this.cashEvents.set([]);
        return;
      }

      this.debug('Subscribing to cash events stream', { id });
      const subscription = this.cashEventService.getCashEvents(id).subscribe({
        next: events => {
          this.debug('Cash events stream emitted', { id, count: events.length });
          this.cashEvents.set(events);
        },
        error: error => {
          this.debug('Cash events stream error', error);
          this.feedbackMessage = this.errorMessage(error, 'Could not load cash entries');
        },
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });

    effect(onCleanup => {
      const id = this.accountId();
      if (!id) {
        this.debug('No account id for cash balance stream, resetting value');
        this.cashBalance.set(0);
        return;
      }

      this.debug('Subscribing to cash balance stream', { id });
      const subscription = this.portfolioService.getCashBalance(id).subscribe({
        next: balance => {
          this.debug('Cash balance stream emitted', { id, balance });
          this.cashBalance.set(balance);
        },
        error: error => {
          this.debug('Cash balance stream error', error);
          this.feedbackMessage = this.errorMessage(error, 'Could not compute cash balance');
        },
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });

    effect(onCleanup => {
      const id = this.accountId();
      if (!id) {
        this.debug('No account id for symbols stream, clearing list');
        this.trackedSymbols.set([]);
        return;
      }

      this.debug('Subscribing to symbols stream', { id });
      const subscription = this.symbolCatalogService.getSymbols(id).subscribe({
        next: symbols => {
          this.debug('Symbols stream emitted', { id, count: symbols.length });
          this.trackedSymbols.set([...symbols].sort((a, b) => a.symbol.localeCompare(b.symbol)));
        },
        error: error => {
          this.debug('Symbols stream error', error);
          this.feedbackMessage = this.errorMessage(error, 'Could not load symbols');
        },
      });
      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });

    effect(() => {
      this.debug('Account signal updated', {
        accountId: this.accountId(),
        accountLoaded: !!this.account(),
      });
    });

    effect(() => {
      const selected = this.selectedSymbol();
      if (selected === 'ALL') {
        return;
      }

      const availableSymbols = this.symbols();
      if (!availableSymbols.includes(selected)) {
        this.debug('Selected symbol no longer available, resetting filter', {
          selected,
          availableSymbolsCount: availableSymbols.length,
        });
        this.selectedSymbol.set('ALL');
      }
    }, { allowSignalWrites: true });
  }

  goBack(): void {
    this.router.navigate(['/accounts']);
  }

  onSymbolChanged(symbol: string): void {
    this.selectedSymbol.set(symbol);
  }

  symbolLabel(symbol: string): string {
    const fullName = this.symbolNameByCode().get(symbol.toUpperCase());
    return fullName ? `${symbol} - ${fullName}` : symbol;
  }

  dividendTypeLabel(dividend: Dividend): string {
    if (!dividend.dividendTypeId) {
      return 'Unspecified';
    }

    return this.dividendTypeNameById().get(dividend.dividendTypeId) ?? 'Deleted type';
  }

  transactionLabel(type: TransactionType): string {
    if (type === 'buy') {
      return 'Purchase';
    }
    if (type === 'sell') {
      return 'Sale';
    }
    return 'Swap';
  }

  transactionInvolvesSymbol(tx: Transaction, selectedSymbol: string): boolean {
    if (selectedSymbol === 'ALL') {
      return true;
    }

    const symbol = this.normalizeSymbol(selectedSymbol);
    const fromSymbol = this.normalizeSymbol(tx.symbol);
    if (fromSymbol === symbol) {
      return true;
    }

    if (tx.type !== 'swap') {
      return false;
    }

    return this.normalizeSymbol(tx.toSymbol) === symbol;
  }

  isSwapOutForSelectedSymbol(tx: Transaction, selectedSymbol: string): boolean {
    if (tx.type !== 'swap' || selectedSymbol === 'ALL') {
      return false;
    }

    return this.normalizeSymbol(tx.symbol) === this.normalizeSymbol(selectedSymbol);
  }

  isSwapInForSelectedSymbol(tx: Transaction, selectedSymbol: string): boolean {
    if (tx.type !== 'swap' || selectedSymbol === 'ALL') {
      return false;
    }

    return this.normalizeSymbol(tx.toSymbol) === this.normalizeSymbol(selectedSymbol);
  }

  displaySymbolForSelection(tx: Transaction, selectedSymbol: string): string {
    if (tx.type !== 'swap') {
      return tx.symbol;
    }

    if (selectedSymbol === 'ALL') {
      return `${tx.symbol} -> ${tx.toSymbol ?? '-'}`;
    }

    if (this.isSwapOutForSelectedSymbol(tx, selectedSymbol)) {
      return tx.symbol;
    }

    if (this.isSwapInForSelectedSymbol(tx, selectedSymbol)) {
      return tx.toSymbol ?? tx.symbol;
    }

    return tx.symbol;
  }

  displayQuantityForSelection(tx: Transaction, selectedSymbol: string): string {
    if (tx.type !== 'swap') {
      return this.formatShareQuantity(tx.quantity);
    }

    if (selectedSymbol === 'ALL') {
      return `${this.formatShareQuantity(tx.quantity)} -> ${this.formatShareQuantity(tx.toQuantity ?? 0)}`;
    }

    if (this.isSwapOutForSelectedSymbol(tx, selectedSymbol)) {
      return this.formatShareQuantity(tx.quantity);
    }

    if (this.isSwapInForSelectedSymbol(tx, selectedSymbol)) {
      return this.formatShareQuantity(tx.toQuantity ?? 0);
    }

    return this.formatShareQuantity(tx.quantity);
  }

  displayPriceForSelection(tx: Transaction): number | null {
    if (tx.type === 'swap') {
      return null;
    }
    return tx.price;
  }

  displayTotalPriceForSelection(tx: Transaction): number | null {
    if (tx.type === 'swap') {
      return null;
    }
    return this.totalPrice(tx);
  }

  displayTotalCostForSelection(tx: Transaction, selectedSymbol: string): number {
    if (tx.type !== 'swap') {
      return this.totalCost(tx);
    }

    if (selectedSymbol === 'ALL') {
      return tx.fees ?? 0;
    }

    if (this.isSwapOutForSelectedSymbol(tx, selectedSymbol)) {
      return tx.fees ?? 0;
    }

    if (this.isSwapInForSelectedSymbol(tx, selectedSymbol)) {
      return 0;
    }

    return tx.fees ?? 0;
  }

  shareDeltaForSelection(tx: Transaction, selectedSymbol: string): number {
    if (tx.type === 'buy') {
      return tx.quantity;
    }

    if (tx.type === 'sell') {
      return -tx.quantity;
    }

    if (selectedSymbol === 'ALL') {
      return 0;
    }

    if (this.isSwapOutForSelectedSymbol(tx, selectedSymbol)) {
      return -tx.quantity;
    }

    if (this.isSwapInForSelectedSymbol(tx, selectedSymbol)) {
      return tx.toQuantity ?? 0;
    }

    return 0;
  }

  cashDeltaForSelection(tx: Transaction, selectedSymbol: string): number {
    const fees = tx.fees ?? 0;

    if (tx.type === 'buy') {
      return -(tx.quantity * tx.price + fees);
    }

    if (tx.type === 'sell') {
      return tx.quantity * tx.price - fees;
    }

    if (selectedSymbol === 'ALL') {
      return -fees;
    }

    if (this.isSwapOutForSelectedSymbol(tx, selectedSymbol)) {
      return -fees;
    }

    if (this.isSwapInForSelectedSymbol(tx, selectedSymbol)) {
      return 0;
    }

    return 0;
  }

  transactionLabelForSelection(tx: Transaction, selectedSymbol: string): string {
    if (tx.type !== 'swap') {
      return this.transactionLabel(tx.type);
    }

    if (selectedSymbol === 'ALL') {
      return 'Swap';
    }

    if (this.isSwapOutForSelectedSymbol(tx, selectedSymbol)) {
      return 'Swap Out';
    }

    if (this.isSwapInForSelectedSymbol(tx, selectedSymbol)) {
      return 'Swap In';
    }

    return 'Swap';
  }

  isTransactionOutflowForSelection(tx: Transaction, selectedSymbol: string): boolean {
    if (tx.type === 'sell') {
      return true;
    }

    if (tx.type !== 'swap') {
      return false;
    }

    if (selectedSymbol === 'ALL') {
      return false;
    }

    return this.isSwapOutForSelectedSymbol(tx, selectedSymbol);
  }

  transactionDetailsForSelection(tx: Transaction, selectedSymbol: string): string {
    if (tx.type !== 'swap') {
      return `${this.symbolLabel(tx.symbol)} (${this.formatShareQuantity(tx.quantity)})`;
    }

    if (selectedSymbol === 'ALL') {
      return `${this.symbolLabel(tx.symbol)} -> ${this.symbolLabel(tx.toSymbol ?? '-')} (${this.formatShareQuantity(tx.quantity)} -> ${this.formatShareQuantity(tx.toQuantity ?? 0)})`;
    }

    if (this.isSwapOutForSelectedSymbol(tx, selectedSymbol)) {
      return `${this.symbolLabel(tx.symbol)} (${this.formatShareQuantity(tx.quantity)})`;
    }

    return `${this.symbolLabel(tx.toSymbol ?? tx.symbol)} (${this.formatShareQuantity(tx.toQuantity ?? 0)})`;
  }

  cashEventLabel(type: CashEventType): string {
    return type === 'deposit' ? 'Deposit' : 'Withdrawal';
  }

  totalPrice(tx: Transaction): number {
    return tx.quantity * tx.price;
  }

  totalCost(tx: Transaction): number {
    const fees = tx.fees ?? 0;
    if (tx.type === 'swap') {
      return fees;
    }
    return tx.type === 'sell' ? this.totalPrice(tx) - fees : this.totalPrice(tx) + fees;
  }

  formatDate(rawDate: unknown): string {
    const date = this.toDate(rawDate);
    if (!date) {
      return 'Unknown';
    }
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(date);
  }

  formatMoney(amount: number, currency: string): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  formatNumber(amount: number): string {
    return new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  formatShareQuantity(amount: number): string {
    return new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(amount);
  }

  cashAmountSigned(event: CashEvent): number {
    return event.type === 'deposit' ? event.amount : -event.amount;
  }

  private normalizeSymbol(symbol: string | undefined | null): string {
    return (symbol ?? '').trim().toUpperCase();
  }

  async openAddTransactionDialog(): Promise<void> {
    const account = this.account();
    if (!account) {
      return;
    }

    const result = await firstValueFrom(
      this.dialog
        .open(TransactionDialogComponent, {
          width: '520px',
          data: {
            accountId: account.id,
            accountCurrency: account.currency,
            symbols: this.trackedSymbols(),
            dividendTypes: this.dividendTypes(),
          },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    await this.createTransaction(account.id, result);
  }

  openCsvImportPicker(fileInput: HTMLInputElement): void {
    if (this.isSaving) {
      return;
    }

    this.feedbackMessage = '';
    fileInput.click();
  }

  async onCsvFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    try {
      await this.importCsvFile(file);
    } finally {
      input.value = '';
    }
  }

  async openEditTransactionDialog(tx: Transaction): Promise<void> {
    const account = this.account();
    if (!account) {
      return;
    }

    const result = await firstValueFrom(
      this.dialog
        .open(TransactionDialogComponent, {
          width: '520px',
          data: {
            accountId: account.id,
            accountCurrency: account.currency,
            symbols: this.trackedSymbols(),
            transaction: tx,
          },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    await this.updateTransaction(account.id, tx.id, result);
  }

  async deleteTransaction(tx: Transaction): Promise<void> {
    const account = this.account();
    if (!account || this.isSaving) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${this.transactionLabel(tx.type).toLowerCase()} for ${tx.symbol} on ${this.formatDate(tx.date)}?`
    );

    if (!confirmed) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.transactionService.deleteTransaction(account.id, tx.id);
      this.feedbackMessage = 'Transaction deleted.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not delete transaction');
    } finally {
      this.isSaving = false;
    }
  }

  async openDeleteAccountDialog(): Promise<void> {
    const account = this.account();
    if (!account || this.isSaving) {
      return;
    }

    const relatedRecordCount =
      this.transactions().length +
      this.dividends().length +
      this.dividendTypes().length +
      this.cashEvents().length +
      this.trackedSymbols().length;

    const confirmed = await firstValueFrom(
      this.dialog
        .open(AccountDeleteConfirmDialogComponent, {
          width: '520px',
          data: {
            accountName: account.name,
            relatedRecordCount,
          },
        })
        .afterClosed()
    );

    if (!confirmed) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.accountService.deleteAccount(account.id);
      await this.router.navigate(['/accounts']);
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not delete account');
    } finally {
      this.isSaving = false;
    }
  }

  async openAddDividendDialog(): Promise<void> {
    const account = this.account();
    if (!account) {
      return;
    }

    const result = await firstValueFrom(
      this.dialog
        .open(DividendDialogComponent, {
          width: '520px',
          data: {
            accountId: account.id,
            accountCurrency: account.currency,
            symbols: this.trackedSymbols(),
            dividendTypes: this.dividendTypes(),
          },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    await this.createDividend(account.id, result);
  }

  async openAddCashEventDialog(): Promise<void> {
    const account = this.account();
    if (!account) {
      return;
    }

    const result = await firstValueFrom(
      this.dialog
        .open(CashEventDialogComponent, {
          width: '460px',
          data: {
            accountCurrency: account.currency,
          },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    await this.createCashEvent(account.id, result);
  }

  async openEditCashEventDialog(cashEvent: CashEvent): Promise<void> {
    const account = this.account();
    if (!account) {
      return;
    }

    const result = await firstValueFrom(
      this.dialog
        .open(CashEventDialogComponent, {
          width: '460px',
          data: {
            accountCurrency: account.currency,
            cashEvent,
          },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    await this.updateCashEvent(account.id, cashEvent.id, result);
  }

  async deleteCashEvent(cashEvent: CashEvent): Promise<void> {
    const account = this.account();
    if (!account || this.isSaving) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${this.cashEventLabel(cashEvent.type).toLowerCase()} entry on ${this.formatDate(cashEvent.date)}?`
    );

    if (!confirmed) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.cashEventService.deleteCashEvent(account.id, cashEvent.id);
      this.feedbackMessage = 'Cash entry deleted.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not delete cash entry');
    } finally {
      this.isSaving = false;
    }
  }

  async openEditDividendDialog(dividend: Dividend): Promise<void> {
    const account = this.account();
    if (!account) {
      return;
    }

    const result = await firstValueFrom(
      this.dialog
        .open(DividendDialogComponent, {
          width: '520px',
          data: {
            accountId: account.id,
            accountCurrency: account.currency,
            symbols: this.trackedSymbols(),
            dividendTypes: this.dividendTypes(),
            dividend,
          },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    await this.updateDividend(account.id, dividend.id, result);
  }

  async openAddSymbolDialog(): Promise<void> {
    const account = this.account();
    if (!account) {
      return;
    }

    const result = await firstValueFrom(
      this.dialog
        .open(SymbolDialogComponent, {
          width: '520px',
          data: {
            accountCurrency: account.currency,
          },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    await this.createSymbol(account.id, result);
  }

  async openEditSymbolDialog(symbol: TrackedSymbol): Promise<void> {
    const account = this.account();
    if (!account) {
      return;
    }

    const result = await firstValueFrom(
      this.dialog
        .open(SymbolDialogComponent, {
          width: '520px',
          data: {
            accountCurrency: account.currency,
            symbol,
          },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    await this.updateSymbol(account.id, symbol.id, result);
  }

  async deleteSymbol(symbol: TrackedSymbol): Promise<void> {
    const account = this.account();
    if (!account || this.isSaving) {
      return;
    }

    const confirmed = window.confirm(
      `Remove ${symbol.symbol} (${symbol.fullName}) from this account symbol list?`
    );

    if (!confirmed) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.symbolCatalogService.deleteSymbol(account.id, symbol.id);
      this.feedbackMessage = 'Symbol removed.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not remove symbol');
    } finally {
      this.isSaving = false;
    }
  }

  async deleteDividend(dividend: Dividend): Promise<void> {
    const account = this.account();
    if (!account || this.isSaving) {
      return;
    }

    const confirmed = window.confirm(
      `Delete dividend for ${dividend.symbol} on ${this.formatDate(dividend.date)}?`
    );

    if (!confirmed) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.dividendService.deleteDividend(account.id, dividend.id);
      this.feedbackMessage = 'Dividend deleted.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not delete dividend');
    } finally {
      this.isSaving = false;
    }
  }

  private async createTransaction(accountId: string, result: TransactionDialogResult): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.transactionService.addTransaction(accountId, {
        symbol: result.symbol,
        type: result.type,
        date: result.date,
        quantity: result.quantity,
        price: result.price,
        fees: result.fees,
        currency: result.currency,
        toSymbol: result.toSymbol,
        toQuantity: result.toQuantity,
      });
      this.feedbackMessage = 'Transaction added.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not add transaction');
    } finally {
      this.isSaving = false;
    }
  }

  private async importCsvFile(file: File): Promise<void> {
    const account = this.account();
    if (!account || this.isSaving) {
      return;
    }

    const isCsv = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv');
    if (!isCsv) {
      this.feedbackMessage = 'Please select a CSV file.';
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      const content = await this.readTextFile(file);
      const rows = this.parseImportCsv(content);

      if (rows.length === 0) {
        this.feedbackMessage = 'No supported transaction/dividend rows found in the CSV.';
        return;
      }

      const confirmImport = window.confirm(
        `Import ${rows.length} record(s) into ${account.name}? This will add new transactions/dividends.`
      );

      if (!confirmImport) {
        this.feedbackMessage = 'CSV import cancelled.';
        return;
      }

      const dividendTypeIdByName = await this.ensureCsvDividendTypes(account.id);
      const existingSymbols = new Set(this.trackedSymbols().map(symbol => symbol.symbol.trim().toUpperCase()));
      const symbolsToCreate = new Map<string, string>();
      const transactionKeys = new Set(
        this.transactions().map(tx => this.buildTransactionDuplicateKey(
          tx.symbol,
          tx.date,
          tx.quantity,
          tx.price,
          tx.fees ?? 0,
        ))
      );
      const dividendKeys = new Set(
        this.dividends().map(dividend => this.buildDividendDuplicateKey(
          dividend.symbol,
          dividend.date,
          dividend.amount,
          dividend.sharesHeld,
        ))
      );

      let importedTransactions = 0;
      let importedDividends = 0;
      let skippedRows = 0;
      let duplicateRows = 0;
      let failedRows = 0;

      for (const row of rows) {
        const symbol = row.ticker.trim().toUpperCase();
        if (!symbol) {
          skippedRows += 1;
          continue;
        }

        if (!existingSymbols.has(symbol)) {
          symbolsToCreate.set(symbol, row.name || symbol);
          existingSymbols.add(symbol);
        }

        if (row.transaction === 'Purchase' || row.transaction === 'Sell' || row.transaction === 'Sale') {
          if (row.shares == null || row.pricePerShare == null) {
            skippedRows += 1;
            continue;
          }

          const transactionKey = this.buildTransactionDuplicateKey(
            symbol,
            row.date,
            row.shares,
            row.pricePerShare,
            row.fees ?? 0,
          );

          if (transactionKeys.has(transactionKey)) {
            duplicateRows += 1;
            skippedRows += 1;
            continue;
          }

          try {
            await this.transactionService.addTransaction(account.id, {
              symbol,
              type: row.transaction === 'Purchase' ? 'buy' : 'sell',
              date: row.date,
              quantity: row.shares,
              price: row.pricePerShare,
              fees: row.fees ?? 0,
              currency: account.currency,
              notes: `Imported from CSV row ${row.rowNumber}.`,
            });
          } catch (error) {
            if (this.isAlreadyExistsError(error)) {
              duplicateRows += 1;
              skippedRows += 1;
              continue;
            }

            failedRows += 1;
            skippedRows += 1;
            continue;
          }

          transactionKeys.add(transactionKey);
          importedTransactions += 1;
          continue;
        }

        if (row.pricePerShare == null) {
          skippedRows += 1;
          continue;
        }

        const dividendKey = this.buildDividendDuplicateKey(
          symbol,
          row.date,
          row.pricePerShare,
          row.shares,
        );

        if (dividendKeys.has(dividendKey)) {
          duplicateRows += 1;
          skippedRows += 1;
          continue;
        }

        const dividendTypeId = dividendTypeIdByName.get(row.transaction);
        try {
          await this.dividendService.addDividend(account.id, {
            symbol,
            dividendTypeId,
            date: row.date,
            amount: row.pricePerShare,
            sharesHeld: row.shares,
            currency: account.currency,
            notes: `Imported from CSV row ${row.rowNumber}.`,
          });
        } catch (error) {
          if (this.isAlreadyExistsError(error)) {
            duplicateRows += 1;
            skippedRows += 1;
            continue;
          }

          failedRows += 1;
          skippedRows += 1;
          continue;
        }

        dividendKeys.add(dividendKey);
        importedDividends += 1;
      }

      for (const [symbol, fullName] of symbolsToCreate.entries()) {
        await this.symbolCatalogService.addSymbol(account.id, {
          symbol,
          fullName,
        });
      }

      this.feedbackMessage =
        `CSV import complete. Added ${importedTransactions} transaction(s), ` +
        `${importedDividends} dividend(s), ${symbolsToCreate.size} new symbol(s)` +
        `${skippedRows > 0 ? `, skipped ${skippedRows} row(s)` : ''}` +
        `${duplicateRows > 0 ? ` (${duplicateRows} duplicate)` : ''}${duplicateRows > 1 ? 's' : ''}` +
        `${failedRows > 0 ? `, ${failedRows} failed row(s)` : ''}.`;
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not import CSV');
    } finally {
      this.isSaving = false;
    }
  }

  private parseImportCsv(content: string): ParsedCsvRow[] {
    const lines = content
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(line => line.trim().length > 0);

    if (lines.length <= AccountDetailsComponent.CSV_HEADER_LINES) {
      return [];
    }

    const dataLines = lines.slice(AccountDetailsComponent.CSV_HEADER_LINES);
    const parsedRows: ParsedCsvRow[] = [];

    for (let index = 0; index < dataLines.length; index += 1) {
      const line = dataLines[index];
      const columns = this.parseCsvLine(line);

      const transactionRaw = (columns[3] ?? '').trim();
      if (!AccountDetailsComponent.CSV_TRANSACTION_TYPES.includes(transactionRaw as CsvTransactionKind)) {
        continue;
      }

      const date = this.parseCsvDate(columns[0] ?? '');
      const ticker = (columns[1] ?? '').trim();
      const name = (columns[2] ?? '').trim();

      if (!date) {
        continue;
      }

      parsedRows.push({
        rowNumber: AccountDetailsComponent.CSV_HEADER_LINES + index + 1,
        date,
        ticker,
        name,
        transaction: transactionRaw as CsvTransactionKind,
        cost: this.parseCsvNumber(columns[4]),
        shares: this.parseCsvNumber(columns[5]),
        pricePerShare: this.parseCsvNumber(columns[6]),
        fees: this.parseCsvNumber(columns[7]),
      });
    }

    return parsedRows;
  }

  private parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];

      if (char === '"') {
        const escapedQuote = inQuotes && line[index + 1] === '"';
        if (escapedQuote) {
          current += '"';
          index += 1;
          continue;
        }

        inQuotes = !inQuotes;
        continue;
      }

      if (char === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    cells.push(current.trim());
    return cells;
  }

  private parseCsvNumber(rawValue?: string): number | undefined {
    if (!rawValue) {
      return undefined;
    }

    const normalized = rawValue.replace(/,/g, '').trim();
    if (!normalized) {
      return undefined;
    }

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private parseCsvDate(rawValue: string): Date | null {
    const value = rawValue.trim();
    if (!value) {
      return null;
    }

    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) {
      return direct;
    }

    const normalized = value.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    const match = normalized.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (!match) {
      return null;
    }

    const day = Number.parseInt(match[1], 10);
    const monthKey = match[2].slice(0, 3).toLowerCase();
    const year = Number.parseInt(match[3], 10);

    const monthIndexMap: Record<string, number> = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };

    const monthIndex = monthIndexMap[monthKey];
    if (monthIndex == null) {
      return null;
    }

    const parsed = new Date(year, monthIndex, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private buildTransactionDuplicateKey(
    symbol: string,
    dateValue: unknown,
    quantity: number,
    price: number,
    fees: number,
  ): string {
    return [
      symbol.trim().toUpperCase(),
      this.toDateKey(dateValue),
      this.toNumberKey(quantity),
      this.toNumberKey(price),
      this.toNumberKey(fees),
    ].join('|');
  }

  private buildDividendDuplicateKey(
    symbol: string,
    dateValue: unknown,
    amount: number,
    sharesHeld?: number,
  ): string {
    return [
      symbol.trim().toUpperCase(),
      this.toDateKey(dateValue),
      this.toNumberKey(amount),
      this.toOptionalNumberKey(sharesHeld),
    ].join('|');
  }

  private toDateKey(value: unknown): string {
    const date = this.toDate(value);
    if (!date) {
      return 'invalid-date';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private toNumberKey(value: number): string {
    return value.toFixed(6);
  }

  private toOptionalNumberKey(value?: number): string {
    if (value == null) {
      return '';
    }

    return this.toNumberKey(value);
  }

  private isAlreadyExistsError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    const code = (error as { code?: string }).code;
    if (typeof code === 'string' && code.toLowerCase().includes('already-exists')) {
      return true;
    }

    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes('already exists');
  }

  private async ensureCsvDividendTypes(accountId: string): Promise<Map<string, string>> {
    const byName = new Map<string, string>();

    for (const dividendType of this.dividendTypes()) {
      byName.set(dividendType.name.trim().toLowerCase(), dividendType.id);
    }

    const result = new Map<string, string>();

    for (const typeName of AccountDetailsComponent.CSV_DIVIDEND_TYPES) {
      const existingId = byName.get(typeName.toLowerCase());
      if (existingId) {
        result.set(typeName, existingId);
        continue;
      }

      const createdId = await this.dividendTypeService.addDividendType(accountId, {
        name: typeName,
        description: 'Created automatically during CSV import.',
      });

      byName.set(typeName.toLowerCase(), createdId);
      result.set(typeName, createdId);
    }

    return result;
  }

  private readTextFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        resolve(result);
      };

      reader.onerror = () => {
        reject(reader.error ?? new Error('Could not read selected file.'));
      };

      reader.readAsText(file);
    });
  }

  private async updateTransaction(
    accountId: string,
    txId: string,
    result: TransactionDialogResult
  ): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.transactionService.updateTransaction(accountId, txId, {
        symbol: result.symbol,
        type: result.type,
        date: result.date,
        quantity: result.quantity,
        price: result.price,
        fees: result.fees,
        currency: result.currency,
        toSymbol: result.toSymbol,
        toQuantity: result.toQuantity,
      });
      this.feedbackMessage = 'Transaction updated.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not update transaction');
    } finally {
      this.isSaving = false;
    }
  }

  private async createDividend(accountId: string, result: DividendDialogResult): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.dividendService.addDividend(accountId, {
        symbol: result.symbol,
        dividendTypeId: result.dividendTypeId,
        date: result.date,
        amount: result.amount,
        perShare: result.perShare,
        sharesHeld: result.sharesHeld,
        notes: result.notes,
        currency: result.currency,
      });
      this.feedbackMessage = 'Dividend added.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not add dividend');
    } finally {
      this.isSaving = false;
    }
  }

  private async updateDividend(
    accountId: string,
    dividendId: string,
    result: DividendDialogResult
  ): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.dividendService.updateDividend(accountId, dividendId, {
        symbol: result.symbol,
        dividendTypeId: result.dividendTypeId,
        date: result.date,
        amount: result.amount,
        perShare: result.perShare,
        sharesHeld: result.sharesHeld,
        notes: result.notes,
        currency: result.currency,
      });
      this.feedbackMessage = 'Dividend updated.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not update dividend');
    } finally {
      this.isSaving = false;
    }
  }

  private async createSymbol(accountId: string, result: SymbolDialogResult): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.symbolCatalogService.addSymbol(accountId, {
        symbol: result.symbol,
        fullName: result.fullName,
      });
      this.feedbackMessage = 'Symbol added.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not add symbol');
    } finally {
      this.isSaving = false;
    }
  }

  private async updateSymbol(accountId: string, symbolId: string, result: SymbolDialogResult): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.symbolCatalogService.updateSymbol(accountId, symbolId, {
        symbol: result.symbol,
        fullName: result.fullName,
      });
      this.feedbackMessage = 'Symbol updated.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not update symbol');
    } finally {
      this.isSaving = false;
    }
  }

  private async createCashEvent(accountId: string, result: CashEventDialogResult): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.cashEventService.addCashEvent(accountId, {
        type: result.type,
        date: result.date,
        amount: result.amount,
        currency: result.currency,
        notes: result.notes,
      });
      this.feedbackMessage = 'Cash entry added.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not add cash entry');
    } finally {
      this.isSaving = false;
    }
  }

  private async updateCashEvent(
    accountId: string,
    cashEventId: string,
    result: CashEventDialogResult
  ): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.cashEventService.updateCashEvent(accountId, cashEventId, {
        type: result.type,
        date: result.date,
        amount: result.amount,
        currency: result.currency,
        notes: result.notes,
      });
      this.feedbackMessage = 'Cash entry updated.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not update cash entry');
    } finally {
      this.isSaving = false;
    }
  }

  private toTimestamp(rawDate: unknown): number {
    const date = this.toDate(rawDate);
    return date?.getTime() ?? 0;
  }

  private toDate(rawDate: unknown): Date | null {
    if (!rawDate) {
      return null;
    }
    if (rawDate instanceof Date) {
      return rawDate;
    }
    if (typeof rawDate === 'object' && rawDate !== null && 'toDate' in rawDate) {
      const maybeDate = (rawDate as { toDate?: () => Date }).toDate?.();
      return maybeDate instanceof Date ? maybeDate : null;
    }
    const parsed = new Date(rawDate as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private errorMessage(error: unknown, prefix: string): string {
    const message = error instanceof Error ? error.message : String(error);
    return `${prefix}: ${message}`;
  }
}
