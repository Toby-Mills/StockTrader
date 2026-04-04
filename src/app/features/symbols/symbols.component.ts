import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AccountService } from '../../core/services/account.service';
import { SymbolCatalogService } from '../../core/services/symbol-catalog.service';
import { Account } from '../../core/models/account.model';
import { TrackedSymbol } from '../../core/models/tracked-symbol.model';
import { SymbolDialogComponent, SymbolDialogResult } from './symbol-dialog.component';

@Component({
  selector: 'app-symbols',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatDialogModule,
  ],
  templateUrl: './symbols.component.html',
  styleUrl: './symbols.component.scss',
})
export class SymbolsComponent {
  private readonly accountService = inject(AccountService);
  private readonly symbolCatalogService = inject(SymbolCatalogService);
  private readonly dialog = inject(MatDialog);

  private readonly accountsSignal = toSignal(this.accountService.getAccounts(), {
    initialValue: [] as Account[],
  });

  readonly accounts = computed(() =>
    [...this.accountsSignal()].sort((a, b) => a.name.localeCompare(b.name))
  );

  readonly selectedAccountId = signal('');
  readonly symbols = signal<TrackedSymbol[]>([]);
  readonly selectedAccount = computed(
    () => this.accounts().find(account => account.id === this.selectedAccountId()) ?? null
  );

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
        this.symbols.set([]);
        return;
      }

      const subscription = this.symbolCatalogService.getSymbols(accountId).subscribe({
        next: symbols => {
          this.symbols.set(
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
    this.feedbackMessage = '';
  }

  async openAddDialog(): Promise<void> {
    const account = this.selectedAccount();
    if (!account) {
      return;
    }

    const result = await firstValueFrom(
      this.dialog
        .open(SymbolDialogComponent, {
          width: '520px',
          data: { accountCurrency: account.currency },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    await this.createSymbol(account.id, result);
  }

  async openEditDialog(symbol: TrackedSymbol): Promise<void> {
    const account = this.selectedAccount();
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
    const account = this.selectedAccount();
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

  private errorMessage(error: unknown, prefix: string): string {
    const message = error instanceof Error ? error.message : String(error);
    return `${prefix}: ${message}`;
  }
}
