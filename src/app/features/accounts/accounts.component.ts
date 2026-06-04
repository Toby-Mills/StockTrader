import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

import { AccountService } from '../../core/services/account.service';
import { Account } from '../../core/models/account.model';
import { AccountDialogComponent, AccountDialogResult } from './account-dialog.component';
import { AccountDeleteConfirmDialogComponent } from './account-delete-confirm-dialog.component';
import { TransactionService } from '../../core/services/transaction.service';
import { DividendService } from '../../core/services/dividend.service';
import { DividendTypeService } from '../../core/services/dividend-type.service';
import { CashEventService } from '../../core/services/cash-event.service';
import { SymbolCatalogService } from '../../core/services/symbol-catalog.service';

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatIconModule,
    MatListModule,
    MatTableModule,
    MatTooltipModule,
  ],
  templateUrl: './accounts.component.html',
  styleUrl: './accounts.component.scss',
})
export class AccountsComponent {
  private readonly accountService = inject(AccountService);
  private readonly transactionService = inject(TransactionService);
  private readonly dividendService = inject(DividendService);
  private readonly dividendTypeService = inject(DividendTypeService);
  private readonly cashEventService = inject(CashEventService);
  private readonly symbolCatalogService = inject(SymbolCatalogService);
  private readonly dialog = inject(MatDialog);

  readonly accounts = toSignal(this.accountService.getAccounts(), { initialValue: [] });
  readonly hasAccounts = computed(() => this.accounts().length > 0);

  displayedColumns = ['name', 'platform', 'accountNumber', 'currency', 'actions'];

  async addAccount(): Promise<void> {
    const dialogRef = this.dialog.open<AccountDialogComponent, never, AccountDialogResult>(
      AccountDialogComponent
    );

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result) {
      await this.accountService.addAccount(result);
    }
  }

  async editAccount(account: Account): Promise<void> {
    const dialogRef = this.dialog.open<AccountDialogComponent, { account: Account }, AccountDialogResult>(
      AccountDialogComponent,
      { data: { account } }
    );

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result) {
      await this.accountService.updateAccount(account.id, result);
    }
  }

  async deleteAccount(account: Account): Promise<void> {
    // We need to fetch the related record count to show in the dialog
    const [txs, divs, divTypes, cashEvents, symbols] = await Promise.all([
      firstValueFrom(this.transactionService.getTransactions(account.id)),
      firstValueFrom(this.dividendService.getDividends(account.id)),
      firstValueFrom(this.dividendTypeService.getDividendTypes(account.id)),
      firstValueFrom(this.cashEventService.getCashEvents(account.id)),
      firstValueFrom(this.symbolCatalogService.getSymbols(account.id)),
    ]);

    const relatedRecordCount = txs.length + divs.length + divTypes.length + cashEvents.length + symbols.length;

    const dialogRef = this.dialog.open<AccountDeleteConfirmDialogComponent, any, boolean>(
      AccountDeleteConfirmDialogComponent,
      {
        width: '520px',
        data: {
          accountName: account.name,
          relatedRecordCount
        }
      }
    );

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result === true) {
      await this.accountService.deleteAccount(account.id);
    }
  }
}
