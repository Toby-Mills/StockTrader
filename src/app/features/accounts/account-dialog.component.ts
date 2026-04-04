import { Component, Inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Account } from '../../core/models/account.model';

interface AccountDialogData {
  account?: Account;
}

export interface AccountDialogResult {
  name: string;
  platform?: string;
  accountNumber?: string;
  currency: string;
}

@Component({
  selector: 'app-account-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  templateUrl: './account-dialog.component.html',
  styleUrl: './account-dialog.component.scss',
})
export class AccountDialogComponent {
  private readonly dialogData: AccountDialogData;

  readonly isEditMode: boolean;
  readonly currencyOptions = ['GBP', 'USD', 'EUR', 'CAD', 'AUD', 'ZAR'];

  readonly form;

  constructor(
    private readonly fb: FormBuilder,
    private readonly dialogRef: MatDialogRef<AccountDialogComponent, AccountDialogResult>,
    @Inject(MAT_DIALOG_DATA) data: AccountDialogData | null
  ) {
    this.dialogData = data ?? {};
    this.isEditMode = !!this.dialogData.account;
    this.form = this.fb.nonNullable.group({
      name: [this.dialogData.account?.name ?? '', [Validators.required, Validators.maxLength(80)]],
      platform: [this.dialogData.account?.platform ?? this.dialogData.account?.broker ?? '', [Validators.maxLength(80)]],
      accountNumber: [this.dialogData.account?.accountNumber ?? '', [Validators.maxLength(80)]],
      currency: [this.dialogData.account?.currency ?? 'GBP', [Validators.required]],
    });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.dialogRef.close({
      name: value.name.trim(),
      platform: value.platform.trim() || undefined,
      accountNumber: value.accountNumber.trim() || undefined,
      currency: value.currency,
    });
  }
}
