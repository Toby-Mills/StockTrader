import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Account } from '../../core/models/account.model';
import { AccountService } from '../../core/services/account.service';
import { Router } from '@angular/router';
import { AccountDialogComponent, AccountDialogResult } from './account-dialog.component';

@Component({
    standalone: true,
    selector: 'app-accounts',
    imports: [MatCardModule, MatButtonModule, MatIconModule, MatDialogModule],
    templateUrl: './accounts.component.html',
    styleUrl: './accounts.component.scss'
})
export class AccountsComponent {
  private readonly accountService = inject(AccountService);
  private readonly dialog = inject(MatDialog);

  private readonly accountsSignal = toSignal(this.accountService.getAccounts(), { initialValue: [] as Account[] });
  private readonly router = inject(Router);

  readonly accounts = computed(() =>
    [...this.accountsSignal()].sort((a, b) => a.name.localeCompare(b.name))
  );

  isSaving = false;
  feedbackMessage = '';

  async openAddDialog(): Promise<void> {
    const result = await this.dialog
      .open(AccountDialogComponent, {
        width: '480px',
      })
      .afterClosed()
      .toPromise();

    if (!result) {
      return;
    }

    await this.createAccount(result);
  }

  async openEditDialog(account: Account): Promise<void> {
    const result = await this.dialog
      .open(AccountDialogComponent, {
        width: '480px',
        data: { account },
      })
      .afterClosed()
      .toPromise();

    if (!result) {
      return;
    }

    await this.updateAccount(account.id, result);
  }

  private async createAccount(result: AccountDialogResult): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.accountService.addAccount({
        name: result.name,
        platform: result.platform,
        accountNumber: result.accountNumber,
        currency: result.currency,
      });
      this.feedbackMessage = 'Account created.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not create account');
    } finally {
      this.isSaving = false;
    }
  }

  private async updateAccount(id: string, result: AccountDialogResult): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.feedbackMessage = '';

    try {
      await this.accountService.updateAccount(id, {
        name: result.name,
        platform: result.platform,
        accountNumber: result.accountNumber,
        currency: result.currency,
      });
      this.feedbackMessage = 'Account updated.';
    } catch (error) {
      this.feedbackMessage = this.errorMessage(error, 'Could not update account');
    } finally {
      this.isSaving = false;
    }
  }

    viewAccountDetails(accountId: string): void {
      this.router.navigate(['/accounts', accountId]);
    }
  private errorMessage(error: unknown, prefix: string): string {
    const message = error instanceof Error ? error.message : String(error);
    return `${prefix}: ${message}`;
  }
}
