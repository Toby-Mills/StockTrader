import { Component, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { toSignal } from '@angular/core/rxjs-interop';
import { AccountService } from '../../core/services/account.service';
import { Transaction, TransactionType } from '../../core/models/transaction.model';
import { Account } from '../../core/models/account.model';
import { TransactionService } from '../../core/services/transaction.service';
import { SymbolCatalogService } from '../../core/services/symbol-catalog.service';
import { TrackedSymbol } from '../../core/models/tracked-symbol.model';
import { TransactionDialogComponent, TransactionDialogResult } from './transaction-dialog.component';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatDialogModule,
  ],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
})
export class TransactionsComponent {
  private readonly accountService = inject(AccountService);
  private readonly transactionService = inject(TransactionService);
  private readonly symbolCatalogService = inject(SymbolCatalogService);
  private readonly dialog = inject(MatDialog);

  private readonly accountsSignal = toSignal(this.accountService.getAccounts(), {
    initialValue: [] as Account[],
  });

  readonly accounts = computed(() =>
    [...this.accountsSignal()].sort((a, b) => a.name.localeCompare(b.name))
  );

  readonly selectedAccountId = signal('');
  readonly selectedSymbol = signal('ALL');
  readonly transactions = signal<Transaction[]>([]);
  readonly trackedSymbols = signal<TrackedSymbol[]>([]);

  readonly symbols = computed(() =>
    [...new Set(this.transactions().map(tx => tx.symbol.toUpperCase()))].sort((a, b) => a.localeCompare(b))
  );

  readonly filteredTransactions = computed(() => {
    const symbol = this.selectedSymbol();
    const txList = [...this.transactions()];
    if (symbol === 'ALL') {
      return txList;
    }
    return txList.filter(tx => tx.symbol.toUpperCase() === symbol);
  });

  readonly selectedAccount = computed(() =>
    this.accounts().find(account => account.id === this.selectedAccountId()) ?? null
  );

  readonly hasAccounts = computed(() => this.accounts().length > 0);

  isSaving = false;
  feedbackMessage = '';

  constructor() {
    effect(() => {
      const accountList = this.accounts();
      const selected = this.selectedAccountId();
      if (!accountList.length) {
        this.selectedAccountId.set('');
        return;
      }
      if (!selected || !accountList.some(account => account.id === selected)) {
        this.selectedAccountId.set(accountList[0].id);
      }
    });

    effect(onCleanup => {
      const accountId = this.selectedAccountId();
      if (!accountId) {
        this.transactions.set([]);
        return;
      }

      const subscription = this.transactionService.getTransactions(accountId).subscribe({
        next: txList => {
          this.transactions.set(txList);
          const symbol = this.selectedSymbol();
          if (symbol !== 'ALL' && !txList.some(tx => tx.symbol.toUpperCase() === symbol)) {
            this.selectedSymbol.set('ALL');
          }
        },
        error: error => {
          this.feedbackMessage = this.errorMessage(error, 'Could not load transactions');
        },
      });

      onCleanup(() => subscription.unsubscribe());
    });

    effect(onCleanup => {
      const accountId = this.selectedAccountId();
      if (!accountId) {
        this.trackedSymbols.set([]);
        return;
      }

      const subscription = this.symbolCatalogService.getSymbols(accountId).subscribe({
        next: symbols => {
          this.trackedSymbols.set(
            [...symbols].sort((a, b) => a.symbol.localeCompare(b.symbol))
          );
        },
        error: error => {
          this.feedbackMessage = this.errorMessage(error, 'Could not load symbols');
        },
      });

      onCleanup(() => subscription.unsubscribe());
    });
  }

  onAccountChanged(accountId: string): void {
    this.selectedAccountId.set(accountId);
    this.selectedSymbol.set('ALL');
    this.feedbackMessage = '';
  }

  onSymbolChanged(symbol: string): void {
    this.selectedSymbol.set(symbol);
  }

  async openAddDialog(): Promise<void> {
    const account = this.selectedAccount();
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
          },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    await this.createTransaction(account.id, result);
  }

  async openEditDialog(tx: Transaction): Promise<void> {
    const account = this.selectedAccount();
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

  transactionLabel(type: TransactionType): string {
    return type === 'buy' ? 'Purchase' : 'Sale';
  }

  totalPrice(tx: Transaction): number {
    return tx.quantity * tx.price;
  }

  totalCost(tx: Transaction): number {
    return this.totalPrice(tx) + (tx.fees ?? 0);
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
      });
      this.feedbackMessage = 'Transaction added.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not add transaction');
    } finally {
      this.isSaving = false;
    }
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
      });
      this.feedbackMessage = 'Transaction updated.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not update transaction');
    } finally {
      this.isSaving = false;
    }
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
