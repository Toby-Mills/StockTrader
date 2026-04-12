import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AccountService } from '../../core/services/account.service';
import { DividendService } from '../../core/services/dividend.service';
import { DividendTypeService } from '../../core/services/dividend-type.service';
import { SymbolCatalogService } from '../../core/services/symbol-catalog.service';
import { Account } from '../../core/models/account.model';
import { Dividend } from '../../core/models/dividend.model';
import { DividendType } from '../../core/models/dividend-type.model';
import { TrackedSymbol } from '../../core/models/tracked-symbol.model';
import { DividendDialogComponent, DividendDialogResult } from './dividend-dialog.component';

@Component({
    standalone: true,
    selector: 'app-dividends',
    imports: [
        MatCardModule,
        MatButtonModule,
        MatFormFieldModule,
        MatSelectModule,
        MatIconModule,
        MatDialogModule,
    ],
    templateUrl: './dividends.component.html',
    styleUrl: './dividends.component.scss'
})
export class DividendsComponent {
  private readonly accountService = inject(AccountService);
  private readonly dividendService = inject(DividendService);
  private readonly dividendTypeService = inject(DividendTypeService);
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
  readonly dividends = signal<Dividend[]>([]);
  readonly dividendTypes = signal<DividendType[]>([]);
  readonly trackedSymbols = signal<TrackedSymbol[]>([]);

  readonly symbolNameByCode = computed(() => {
    const lookup = new Map<string, string>();
    for (const symbol of this.trackedSymbols()) {
      lookup.set(symbol.symbol.trim().toUpperCase(), symbol.fullName);
    }
    return lookup;
  });

  readonly symbols = computed(() =>
    [...new Set(this.dividends().map(div => div.symbol.toUpperCase()))].sort((a, b) => a.localeCompare(b))
  );

  readonly dividendTypeNameById = computed(() => {
    const lookup = new Map<string, string>();
    for (const type of this.dividendTypes()) {
      lookup.set(type.id, type.name);
    }
    return lookup;
  });

  readonly filteredDividends = computed(() => {
    const symbol = this.selectedSymbol();
    const list = [...this.dividends()];
    if (symbol === 'ALL') {
      return list;
    }
    return list.filter(div => div.symbol.toUpperCase() === symbol);
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
    }, { allowSignalWrites: true });

    effect(onCleanup => {
      const accountId = this.selectedAccountId();
      if (!accountId) {
        this.dividends.set([]);
        return;
      }

      const subscription = this.dividendService.getDividends(accountId).subscribe({
        next: async dividends => {
          this.dividends.set(dividends);
          await this.syncOrphanedDividendTypes(accountId, dividends);
          const symbol = this.selectedSymbol();
          if (symbol !== 'ALL' && !dividends.some(div => div.symbol.toUpperCase() === symbol)) {
            this.selectedSymbol.set('ALL');
          }
        },
        error: error => {
          this.feedbackMessage = this.errorMessage(error, 'Could not load dividends');
        },
      });

      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });

    effect(onCleanup => {
      const accountId = this.selectedAccountId();
      if (!accountId) {
        this.dividendTypes.set([]);
        return;
      }

      const subscription = this.dividendTypeService.getDividendTypes(accountId).subscribe({
        next: types => {
          this.dividendTypes.set(
            [...types].sort((a, b) => a.name.localeCompare(b.name))
          );
        },
        error: error => {
          this.feedbackMessage = this.errorMessage(error, 'Could not load dividend types');
        },
      });

      onCleanup(() => subscription.unsubscribe());
    }, { allowSignalWrites: true });

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
    }, { allowSignalWrites: true });
  }

  onAccountChanged(accountId: string): void {
    this.selectedAccountId.set(accountId);
    this.selectedSymbol.set('ALL');
    this.feedbackMessage = '';
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

  async openAddDialog(): Promise<void> {
    const account = this.selectedAccount();
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

  async openEditDialog(dividend: Dividend): Promise<void> {
    const account = this.selectedAccount();
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

  async deleteDividend(dividend: Dividend): Promise<void> {
    const account = this.selectedAccount();
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

  private async updateDividend(accountId: string, dividendId: string, result: DividendDialogResult): Promise<void> {
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

  private async syncOrphanedDividendTypes(accountId: string, dividends: Dividend[]): Promise<void> {
    if (!accountId || dividends.length === 0) {
      return;
    }

    // Collect all unique typeIds referenced by dividends
    const referencedTypeIds = new Set<string>();
    for (const dividend of dividends) {
      if (dividend.dividendTypeId) {
        referencedTypeIds.add(dividend.dividendTypeId);
      }
    }

    if (referencedTypeIds.size === 0) {
      return;
    }

    // Get current types to identify which are missing
    const currentTypes = this.dividendTypes();
    const existingTypeIds = new Set(currentTypes.map(t => t.id));
    const orphanedTypeIds = Array.from(referencedTypeIds).filter(id => !existingTypeIds.has(id));

    if (orphanedTypeIds.length === 0) {
      return;
    }

    // Create placeholder records for orphaned types with their existing IDs
    try {
      for (const orphanedId of orphanedTypeIds) {
        // Create a placeholder type with the orphaned ID so dividends can reference it
        await this.dividendTypeService.addDividendTypeWithId(accountId, orphanedId, {
          name: `Legacy Type (${orphanedId})`,
          description: 'Auto-created from existing dividend record',
        });
      }

      // Refresh types from Firestore to get the newly created types
      const updatedTypes = await firstValueFrom(this.dividendTypeService.getDividendTypes(accountId));
      this.dividendTypes.set(
        [...updatedTypes].sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not sync orphaned dividend types: ${message}`);
    }
  }

}
