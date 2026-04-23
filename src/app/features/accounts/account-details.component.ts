import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';

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
import { SymbolComponent } from '../../shared/symbol-chip.component';

interface CashLedgerRow {
  id: string;
  date: unknown;
  createdAt?: unknown;
  source: 'cash-event' | 'dividend' | 'transaction';
  sourceLabel: string;
  details: string;
  symbol?: string;
  toSymbol?: string;
  amount: number;
  currency: string;
  notes?: string;
  cashEvent?: CashEvent;
  dividend?: Dividend;
  transaction?: Transaction;
}

type CsvTransactionKind = 'Purchase' | 'Sell' | 'Sale' | 'Dividend' | 'Foreign Dividends' | 'REIT Distribution' | 'Securities Interest' | 'Foreign Dividend Witholding Tax';

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
  dividendValue?: number;
}

type InlineTransactionField = 'date' | 'symbol' | 'type' | 'quantity' | 'price' | 'fees' | 'notes';

interface InlineTransactionEditingCell {
  txId: string;
  field: InlineTransactionField;
}

interface InlineTransactionDraft {
  date: string;
  symbol: string;
  toSymbol: string;
  type: TransactionType;
  quantity: string;
  toQuantity: string;
  price: string;
  fees: string;
  notes: string;
}

type InlineDividendField = 'date' | 'symbol' | 'dividendType' | 'amount' | 'sharesHeld' | 'notes';

interface InlineDividendEditingCell {
  dividendId: string;
  field: InlineDividendField;
}

interface InlineDividendDraft {
  date: string;
  symbol: string;
  dividendTypeName: string;
  amount: string;
  fee: string;
  perShare: string;
  sharesHeld: string;
  notes: string;
}

interface SymbolFilterOption {
  symbol: string;
  fullName: string;
  providerGroup: string;
  showDivider: boolean;
}

@Component({
  selector: 'app-account-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatSnackBarModule,
    MatDialogModule,
    SymbolComponent,
  ],
  templateUrl: './account-details.component.html',
  styleUrl: './account-details.component.scss',
})
export class AccountDetailsComponent {
  private static readonly CSV_DIVIDEND_TYPES: readonly CsvTransactionKind[] = [
    'Dividend',
    'Foreign Dividends',
    'REIT Distribution',
    'Securities Interest',
    'Foreign Dividend Witholding Tax',
  ];

  private static readonly CSV_TRANSACTION_TYPES: readonly CsvTransactionKind[] = [
    'Purchase',
    'Sell',
    'Sale',
    ...AccountDetailsComponent.CSV_DIVIDEND_TYPES,
  ];

  private static readonly CSV_HEADER_LINES = 1;

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
  private readonly snackBar = inject(MatSnackBar);

  readonly accountId = signal<string | null>(null);
  readonly account = signal<Account | null>(null);
  readonly transactions = signal<Transaction[]>([]);
  readonly dividends = signal<Dividend[]>([]);
  readonly dividendTypes = signal<DividendType[]>([]);
  readonly cashEvents = signal<CashEvent[]>([]);
  readonly cashBalance = signal(0);
  readonly trackedSymbols = signal<TrackedSymbol[]>([]);
  readonly selectedSymbol = signal('ALL');
  readonly selectedContentType = signal<'transactions' | 'dividends' | 'cash-events' | null>(null);

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

  readonly symbolFilterOptions = computed<SymbolFilterOption[]>(() => {
    const symbolNames = this.symbolNameByCode();
    const options = this.symbols().map(symbol => {
      const fullName = symbolNames.get(symbol) ?? '';
      return {
        symbol,
        fullName,
        providerGroup: this.providerGroupFromName(fullName),
        showDivider: false,
      };
    });

    options.sort((a, b) => {
      const providerCompare = a.providerGroup.localeCompare(b.providerGroup);
      if (providerCompare !== 0) {
        return providerCompare;
      }

      const nameCompare = a.fullName.localeCompare(b.fullName);
      if (nameCompare !== 0) {
        return nameCompare;
      }

      return a.symbol.localeCompare(b.symbol);
    });

    return options.map((option, index, list) => ({
      ...option,
      showDivider: index > 0 && option.providerGroup !== list[index - 1].providerGroup,
    }));
  });

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
      .reduce((sum, div) => sum + this.netDividendAmount(div), 0);

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
          details: this.cashEventDetails(event.type),
          amount: this.cashAmountSigned(event),
          currency: event.currency,
          notes: this.cashEventNotes(event),
          cashEvent: event,
        });
      }
    }

    for (const dividend of this.filteredDividends()) {
      const fullName = this.symbolNameByCode().get(dividend.symbol.trim().toUpperCase()) ?? '';
      rows.push({
        id: `dividend-${dividend.id}`,
        date: dividend.date,
        createdAt: dividend.createdAt,
        source: 'dividend',
        sourceLabel: 'Dividend',
        details: fullName,
        symbol: dividend.symbol,
        amount: this.netDividendAmount(dividend),
        currency: dividend.currency,
        notes: this.dividendNotes(dividend),
        dividend,
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
        details: this.transactionQuantityDetailsForSelection(tx, symbol),
        symbol: this.getSymbolForDisplay(tx, symbol),
        toSymbol: tx.type === 'swap' && symbol === 'ALL' ? (tx.toSymbol ?? undefined) : undefined,
        amount,
        currency: tx.currency,
        notes: fees > 0 ? `Fees: ${this.formatNumber(fees)}` : undefined,
        transaction: tx,
      });
    }

    return sortByDateAndCreatedAt(rows);
  });

  readonly filteredCashEvents = computed(() => {
    const rows: CashLedgerRow[] = [];
    const symbol = this.selectedSymbol();

    // Only add cash events (not transactions or dividends)
    if (symbol === 'ALL') {
      for (const event of this.cashEvents()) {
        rows.push({
          id: `cash-event-${event.id}`,
          date: event.date,
          createdAt: event.createdAt,
          source: 'cash-event',
          sourceLabel: this.cashEventLabel(event.type),
          details: this.cashEventDetails(event.type),
          amount: this.cashAmountSigned(event),
          currency: event.currency,
          notes: this.cashEventNotes(event),
          cashEvent: event,
        });
      }
    } else {
      // Cash events don't have symbols, so show all
      for (const event of this.cashEvents()) {
        rows.push({
          id: `cash-event-${event.id}`,
          date: event.date,
          createdAt: event.createdAt,
          source: 'cash-event',
          sourceLabel: this.cashEventLabel(event.type),
          details: this.cashEventDetails(event.type),
          amount: this.cashAmountSigned(event),
          currency: event.currency,
          notes: this.cashEventNotes(event),
          cashEvent: event,
        });
      }
    }

    return sortByDateAndCreatedAt(rows);
  });

  readonly contentToDisplay = computed(() => {
    const type = this.selectedContentType();
    
    if (type === 'transactions') {
      return { type: 'transactions' as const, list: this.filteredTransactions() };
    } else if (type === 'dividends') {
      return { type: 'dividends' as const, list: this.filteredDividends() };
    } else if (type === 'cash-events') {
      return { type: 'cash-events' as const, list: this.filteredCashEvents() };
    } else {
      // null = show all combined
      return { type: 'all' as const, list: this.cashLedgerRows() };
    }
  });

  readonly inlineEditingCell = signal<InlineTransactionEditingCell | null>(null);
  readonly inlineEditingDividendCell = signal<InlineDividendEditingCell | null>(null);

  isSaving = false;
  private _feedbackMessage = '';
  inlineEditDraft: InlineTransactionDraft = this.createEmptyInlineTransactionDraft();
  inlineEditError = '';
  inlineDividendEditDraft: InlineDividendDraft = this.createEmptyInlineDividendDraft();
  inlineDividendEditError = '';

  get feedbackMessage(): string {
    return this._feedbackMessage;
  }

  set feedbackMessage(value: string) {
    this._feedbackMessage = value;
    if (!value) {
      return;
    }

    this.snackBar.open(value, 'Dismiss', {
      duration: 4000,
      horizontalPosition: 'end',
      verticalPosition: 'top',
    });
  }

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
    this.cancelAllInlineEdits();
    this.selectedSymbol.set(symbol);
  }

  onContentTypeChanged(type: string | null): void {
    this.cancelAllInlineEdits();
    this.selectedContentType.set(type as 'transactions' | 'dividends' | 'cash-events' | null);
  }

  canInlineEditTransactionField(tx: Transaction, field: InlineTransactionField): boolean {
    if (field === 'price') {
      return tx.type !== 'swap';
    }

    if (field === 'type') {
      return tx.type !== 'swap';
    }

    return true;
  }

  isInlineEditing(txId: string, field: InlineTransactionField): boolean {
    const activeCell = this.inlineEditingCell();
    return activeCell?.txId === txId && activeCell.field === field;
  }

  startInlineEdit(tx: Transaction, field: InlineTransactionField): void {
    if (this.isSaving || !this.canInlineEditTransactionField(tx, field)) {
      return;
    }

    this.cancelInlineDividendEdit();
    this.inlineEditDraft = this.createInlineTransactionDraft(tx);
    this.inlineEditError = '';
    this.inlineEditingCell.set({ txId: tx.id, field });
  }

  cancelInlineEdit(): void {
    this.inlineEditingCell.set(null);
    this.inlineEditError = '';
  }

  canInlineEditDividendField(_dividend: Dividend, _field: InlineDividendField): boolean {
    return true;
  }

  isInlineEditingDividend(dividendId: string, field: InlineDividendField): boolean {
    const activeCell = this.inlineEditingDividendCell();
    return activeCell?.dividendId === dividendId && activeCell.field === field;
  }

  startInlineDividendEdit(dividend: Dividend, field: InlineDividendField): void {
    if (this.isSaving || !this.canInlineEditDividendField(dividend, field)) {
      return;
    }

    this.cancelInlineEdit();
    this.inlineDividendEditDraft = this.createInlineDividendDraft(dividend);
    this.inlineDividendEditError = '';
    this.inlineEditingDividendCell.set({ dividendId: dividend.id, field });
  }

  cancelInlineDividendEdit(): void {
    this.inlineEditingDividendCell.set(null);
    this.inlineDividendEditError = '';
  }

  cancelAllInlineEdits(): void {
    this.cancelInlineEdit();
    this.cancelInlineDividendEdit();
  }

  async saveInlineDividendEdit(dividend: Dividend): Promise<void> {
    const activeCell = this.inlineEditingDividendCell();
    const account = this.account();
    if (!activeCell || activeCell.dividendId !== dividend.id || !account || this.isSaving) {
      return;
    }

    const changes = await this.buildInlineDividendChanges(account.id, activeCell.field);
    if (!changes) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';
    this.inlineDividendEditError = '';

    try {
      await this.dividendService.updateDividend(account.id, dividend.id, changes);
      this.feedbackMessage = 'Dividend updated.';
      this.cancelInlineDividendEdit();
    } catch (error) {
      const message = this.errorMessage(error, 'Could not update dividend');
      this.inlineDividendEditError = message;
      this.feedbackMessage = message;
    } finally {
      this.isSaving = false;
    }
  }

  onInlineDividendEditKeydown(event: KeyboardEvent, dividend: Dividend, field: InlineDividendField): void {
    if (!this.isInlineEditingDividend(dividend.id, field)) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelInlineDividendEdit();
      return;
    }

    if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement) && !event.shiftKey) {
      event.preventDefault();
      void this.saveInlineDividendEdit(dividend);
    }
  }

  async saveInlineEdit(tx: Transaction): Promise<void> {
    const activeCell = this.inlineEditingCell();
    const account = this.account();
    if (!activeCell || activeCell.txId !== tx.id || !account || this.isSaving) {
      return;
    }

    const changes = this.buildInlineTransactionChanges(tx, activeCell.field);
    if (!changes) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';
    this.inlineEditError = '';

    try {
      await this.transactionService.updateTransaction(account.id, tx.id, changes);
      this.feedbackMessage = 'Transaction updated.';
      this.cancelInlineEdit();
    } catch (error) {
      const message = this.errorMessage(error, 'Could not update transaction');
      this.inlineEditError = message;
      this.feedbackMessage = message;
    } finally {
      this.isSaving = false;
    }
  }

  onInlineEditKeydown(event: KeyboardEvent, tx: Transaction, field: InlineTransactionField): void {
    if (!this.isInlineEditing(tx.id, field)) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelInlineEdit();
      return;
    }

    if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement) && !event.shiftKey) {
      event.preventDefault();
      void this.saveInlineEdit(tx);
    }
  }

  symbolLabel(symbol: string): string {
    const fullName = this.symbolNameByCode().get(symbol.toUpperCase());
    return fullName ? `${symbol} - ${fullName}` : symbol;
  }

  private providerGroupFromName(fullName: string): string {
    const trimmed = fullName.trim();
    if (!trimmed) {
      return 'zzzz';
    }

    const firstWord = trimmed.split(/\s+/)[0] ?? '';
    return firstWord.toLowerCase();
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

  isStockSplitForSelectedSymbol(tx: Transaction, selectedSymbol: string): boolean {
    if (tx.type !== 'swap' || selectedSymbol === 'ALL') {
      return false;
    }

    const symbol = this.normalizeSymbol(selectedSymbol);
    return this.normalizeSymbol(tx.symbol) === symbol && this.normalizeSymbol(tx.toSymbol) === symbol;
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

  getSymbolForDisplay(tx: Transaction, selectedSymbol: string): string {
    if (tx.type !== 'swap') {
      return tx.symbol;
    }

    if (selectedSymbol === 'ALL') {
      return tx.symbol; // Return just the primary symbol for the chip
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

    if (selectedSymbol === 'ALL' || this.isStockSplitForSelectedSymbol(tx, selectedSymbol)) {
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

    if (this.isStockSplitForSelectedSymbol(tx, selectedSymbol)) {
      return (tx.toQuantity ?? 0) - tx.quantity;
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

    if (this.isStockSplitForSelectedSymbol(tx, selectedSymbol)) {
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

    if (selectedSymbol === 'ALL' || this.isStockSplitForSelectedSymbol(tx, selectedSymbol)) {
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

    if (this.isStockSplitForSelectedSymbol(tx, selectedSymbol)) {
      return false;
    }

    return this.isSwapOutForSelectedSymbol(tx, selectedSymbol);
  }

  transactionDetailsForSelection(tx: Transaction, selectedSymbol: string): string {
    if (tx.type !== 'swap') {
      return `${this.symbolLabel(tx.symbol)} (${this.formatShareQuantity(tx.quantity)})`;
    }

    if (selectedSymbol === 'ALL' || this.isStockSplitForSelectedSymbol(tx, selectedSymbol)) {
      return `${this.symbolLabel(tx.symbol)} -> ${this.symbolLabel(tx.toSymbol ?? '-')} (${this.formatShareQuantity(tx.quantity)} -> ${this.formatShareQuantity(tx.toQuantity ?? 0)})`;
    }

    if (this.isSwapOutForSelectedSymbol(tx, selectedSymbol)) {
      return `${this.symbolLabel(tx.symbol)} (${this.formatShareQuantity(tx.quantity)})`;
    }

    return `${this.symbolLabel(tx.toSymbol ?? tx.symbol)} (${this.formatShareQuantity(tx.toQuantity ?? 0)})`;
  }

  transactionQuantityDetailsForSelection(tx: Transaction, selectedSymbol: string): string {
    const fromName = this.symbolNameByCode().get(this.normalizeSymbol(tx.symbol)) ?? '';
    const toName = this.symbolNameByCode().get(this.normalizeSymbol(tx.toSymbol)) ?? '';

    if (tx.type !== 'swap') {
      const quantity = this.formatShareQuantity(tx.quantity);
      return fromName ? `${fromName} (${quantity})` : `(${quantity})`;
    }

    if (selectedSymbol === 'ALL' || this.isStockSplitForSelectedSymbol(tx, selectedSymbol)) {
      const fromQty = this.formatShareQuantity(tx.quantity);
      const toQty = this.formatShareQuantity(tx.toQuantity ?? 0);
      if (fromName && toName) {
        return `${fromName} -> ${toName} (${fromQty} -> ${toQty})`;
      }
      return `(${fromQty} -> ${toQty})`;
    }

    if (this.isSwapOutForSelectedSymbol(tx, selectedSymbol)) {
      const quantity = this.formatShareQuantity(tx.quantity);
      return fromName ? `${fromName} (${quantity})` : `(${quantity})`;
    }

    const quantity = this.formatShareQuantity(tx.toQuantity ?? 0);
    return toName ? `${toName} (${quantity})` : `(${quantity})`;
  }

  cashEventLabel(type: CashEventType): string {
    switch (type) {
      case 'deposit':
        return 'Deposit';
      case 'withdrawal':
        return 'Withdrawal';
      case 'fee':
        return 'Account Fee';
      case 'interest':
        return 'Interest on Cash';
      default:
        return type;
    }
  }

  cashEventDetails(type: CashEventType): string {
    switch (type) {
      case 'deposit':
        return 'Account funding';
      case 'withdrawal':
        return 'Cash withdrawal';
      case 'fee':
        return 'Account fee';
      case 'interest':
        return 'Interest on cash';
      default:
        return type;
    }
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
    const fee = event.fee ?? 0;
    return event.type === 'deposit' || event.type === 'interest'
      ? event.amount - fee
      : -(event.amount + fee);
  }

  cashEventNotes(event: CashEvent): string | undefined {
    const fee = event.fee ?? 0;
    const trimmedNotes = event.notes?.trim();
    if (fee === 0) {
      return trimmedNotes || undefined;
    }

    const feeMessage = `Fee: ${this.formatNumber(fee)}`;
    if (!trimmedNotes) {
      return feeMessage;
    }

    return `${feeMessage}. ${trimmedNotes}`;
  }

  netDividendAmount(dividend: Dividend): number {
    return dividend.amount - (dividend.fee ?? 0);
  }

  dividendNotes(dividend: Dividend): string | undefined {
    const fee = dividend.fee ?? 0;
    const trimmedNotes = dividend.notes?.trim();
    if (fee === 0) {
      return trimmedNotes || undefined;
    }

    const feeMessage = `Fee: ${this.formatNumber(fee)}`;
    if (!trimmedNotes) {
      return feeMessage;
    }

    return `${feeMessage}. ${trimmedNotes}`;
  }

  private normalizeSymbol(symbol: string | undefined | null): string {
    return (symbol ?? '').trim().toUpperCase();
  }

  async openAddTransactionDialog(): Promise<void> {
    this.cancelAllInlineEdits();

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
    this.cancelAllInlineEdits();

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
    this.cancelAllInlineEdits();

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
    this.cancelAllInlineEdits();

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
        notes: result.notes,
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

        if (row.dividendValue == null) {
          skippedRows += 1;
          continue;
        }

        const dividendKey = this.buildDividendDuplicateKey(
          symbol,
          row.date,
          row.dividendValue,
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
            amount: row.dividendValue,
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
        dividendValue: this.parseCsvNumber(columns[9]),
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
        notes: result.notes,
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

  private createEmptyInlineTransactionDraft(): InlineTransactionDraft {
    return {
      date: '',
      symbol: '',
      toSymbol: '',
      type: 'buy',
      quantity: '',
      toQuantity: '',
      price: '',
      fees: '',
      notes: '',
    };
  }

  private createEmptyInlineDividendDraft(): InlineDividendDraft {
    return {
      date: '',
      symbol: '',
      dividendTypeName: '',
      amount: '',
      fee: '',
      perShare: '',
      sharesHeld: '',
      notes: '',
    };
  }

  private createInlineTransactionDraft(tx: Transaction): InlineTransactionDraft {
    return {
      date: this.toDateInputValue(tx.date),
      symbol: tx.symbol,
      toSymbol: tx.toSymbol ?? '',
      type: tx.type,
      quantity: String(tx.quantity),
      toQuantity: tx.toQuantity == null ? '' : String(tx.toQuantity),
      price: String(tx.price),
      fees: String(tx.fees ?? 0),
      notes: tx.notes ?? '',
    };
  }

  private createInlineDividendDraft(dividend: Dividend): InlineDividendDraft {
    return {
      date: this.toDateInputValue(dividend.date),
      symbol: dividend.symbol,
      dividendTypeName: this.dividendTypeLabel(dividend),
      amount: String(dividend.amount),
      fee: String(dividend.fee ?? 0),
      perShare: dividend.perShare == null ? '' : String(dividend.perShare),
      sharesHeld: dividend.sharesHeld == null ? '' : String(dividend.sharesHeld),
      notes: dividend.notes ?? '',
    };
  }

  private buildInlineTransactionChanges(tx: Transaction, field: InlineTransactionField): Partial<Transaction> | null {
    switch (field) {
      case 'date': {
        const date = this.parseInlineDate(this.inlineEditDraft.date);
        if (!date) {
          this.inlineEditError = 'Enter a valid date.';
          return null;
        }
        return { date };
      }

      case 'symbol': {
        const symbol = this.inlineEditDraft.symbol.trim().toUpperCase();
        if (!symbol) {
          this.inlineEditError = 'Enter a symbol.';
          return null;
        }

        if (tx.type !== 'swap') {
          return { symbol };
        }

        const toSymbol = this.inlineEditDraft.toSymbol.trim().toUpperCase();
        if (!toSymbol) {
          this.inlineEditError = 'Enter the destination symbol for this swap.';
          return null;
        }

        return { symbol, toSymbol };
      }

      case 'type': {
        if (tx.type === 'swap') {
          this.inlineEditError = 'Use the dialog for swap type changes.';
          return null;
        }

        if (this.inlineEditDraft.type === 'swap') {
          this.inlineEditError = 'Use the dialog to convert a purchase or sale into a swap.';
          return null;
        }

        return { type: this.inlineEditDraft.type };
      }

      case 'quantity': {
        const quantity = this.parseInlineNumber(this.inlineEditDraft.quantity, tx.type === 'swap' ? 0 : Number.EPSILON);
        if (quantity == null) {
          this.inlineEditError = tx.type === 'swap'
            ? 'Enter a quantity of zero or more.'
            : 'Enter a quantity greater than zero.';
          return null;
        }

        if (tx.type !== 'swap') {
          return { quantity };
        }

        const toQuantity = this.parseInlineNumber(this.inlineEditDraft.toQuantity, 0);
        if (toQuantity == null) {
          this.inlineEditError = 'Enter the destination quantity for this swap.';
          return null;
        }

        return { quantity, toQuantity };
      }

      case 'price': {
        if (tx.type === 'swap') {
          this.inlineEditError = 'Swap rows do not have a price.';
          return null;
        }

        const price = this.parseInlineNumber(this.inlineEditDraft.price, 0);
        if (price == null) {
          this.inlineEditError = 'Enter a price of zero or more.';
          return null;
        }

        return { price };
      }

      case 'fees': {
        const fees = this.parseInlineNumber(this.inlineEditDraft.fees, null);
        if (fees == null) {
          this.inlineEditError = 'Enter a valid fee amount.';
          return null;
        }

        return { fees };
      }

      case 'notes':
        return { notes: this.inlineEditDraft.notes.trim() || undefined };

      default:
        return null;
    }
  }

  private async buildInlineDividendChanges(accountId: string, field: InlineDividendField): Promise<Partial<Dividend> | null> {
    switch (field) {
      case 'date': {
        const date = this.parseInlineDate(this.inlineDividendEditDraft.date);
        if (!date) {
          this.inlineDividendEditError = 'Enter a valid date.';
          return null;
        }

        return { date };
      }

      case 'symbol': {
        const symbol = this.inlineDividendEditDraft.symbol.trim().toUpperCase();
        if (!symbol) {
          this.inlineDividendEditError = 'Enter a symbol.';
          return null;
        }

        return { symbol };
      }

      case 'dividendType': {
        const dividendTypeName = this.inlineDividendEditDraft.dividendTypeName.trim();
        if (!dividendTypeName) {
          this.inlineDividendEditError = 'Enter a dividend type.';
          return null;
        }

        const dividendTypeId = await this.resolveInlineDividendTypeId(accountId, dividendTypeName);
        return { dividendTypeId };
      }

      case 'amount': {
        const amount = this.parseInlineNumber(this.inlineDividendEditDraft.amount, null);
        if (amount == null) {
          this.inlineDividendEditError = 'Enter a valid gross amount.';
          return null;
        }

        const fee = this.parseInlineNumber(this.inlineDividendEditDraft.fee, null);
        if (fee == null) {
          this.inlineDividendEditError = 'Enter a valid fee amount.';
          return null;
        }

        const perShare = this.inlineDividendEditDraft.perShare.trim();
        if (!perShare) {
          return { amount, fee, perShare: undefined };
        }

        const parsedPerShare = this.parseInlineNumber(perShare, null);
        if (parsedPerShare == null) {
          this.inlineDividendEditError = 'Enter a valid per-share amount.';
          return null;
        }

        return { amount, fee, perShare: parsedPerShare };
      }

      case 'sharesHeld': {
        const sharesHeld = this.inlineDividendEditDraft.sharesHeld.trim();
        if (!sharesHeld) {
          return { sharesHeld: undefined };
        }

        const parsedSharesHeld = this.parseInlineNumber(sharesHeld, 0);
        if (parsedSharesHeld == null) {
          this.inlineDividendEditError = 'Enter shares held of zero or more.';
          return null;
        }

        return { sharesHeld: parsedSharesHeld };
      }

      case 'notes':
        return { notes: this.inlineDividendEditDraft.notes.trim() || undefined };

      default:
        return null;
    }
  }

  private async resolveInlineDividendTypeId(accountId: string, typeNameInput: string): Promise<string> {
    const typeName = typeNameInput.trim();
    const existing = this.findDividendTypeByName(typeName);
    if (existing) {
      return existing.id;
    }

    return this.dividendTypeService.addDividendType(accountId, {
      name: typeName,
      description: undefined,
    });
  }

  private findDividendTypeByName(name: string): DividendType | undefined {
    const normalized = name.trim().toLowerCase();
    return this.dividendTypes().find(type => type.name.trim().toLowerCase() === normalized);
  }

  private parseInlineNumber(rawValue: string, minValue: number | null): number | null {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    if (minValue != null && parsed < minValue) {
      return null;
    }

    return parsed;
  }

  private toDateInputValue(rawDate: unknown): string {
    const date = this.toDate(rawDate);
    if (!date) {
      return '';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseInlineDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, monthIndex, day, 12, 0, 0, 0);

    if (
      date.getFullYear() !== year
      || date.getMonth() !== monthIndex
      || date.getDate() !== day
    ) {
      return null;
    }

    return date;
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
        fee: result.fee,
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
        fee: result.fee,
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
        fee: result.fee,
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
        fee: result.fee,
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
