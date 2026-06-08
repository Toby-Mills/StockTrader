import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AccountSnapshot } from '../../../core/models/account-snapshot.model';
import { PortfolioService } from '../../../core/services/portfolio.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { DividendService } from '../../../core/services/dividend.service';
import { CashEventService } from '../../../core/services/cash-event.service';
import { combineLatest, firstValueFrom } from 'rxjs';

export interface AccountSnapshotDialogData {
  accountId: string;
  currency: string;
  snapshot?: AccountSnapshot;
}

@Component({
  selector: 'app-account-snapshot-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDatepickerModule,
    MatIconModule,
  ],
  templateUrl: './account-snapshot-dialog.component.html',
  styles: `
    mat-form-field {
      width: 100%;
      margin-bottom: 1rem;
    }
    .hint {
      font-size: 0.85rem;
      color: rgba(0, 0, 0, 0.6);
      margin-bottom: 1.5rem;
    }
  `,
})
export class AccountSnapshotDialogComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly portfolioService = inject(PortfolioService);
  private readonly transactionService = inject(TransactionService);
  private readonly dividendService = inject(DividendService);
  private readonly cashEventService = inject(CashEventService);
  private readonly dialogRef = inject(MatDialogRef<AccountSnapshotDialogComponent>);

  readonly form: FormGroup;
  readonly isEdit: boolean;

  constructor(@Inject(MAT_DIALOG_DATA) public data: AccountSnapshotDialogData) {
    this.isEdit = !!data.snapshot;
    this.form = this.fb.group({
      date: [data.snapshot?.date ? this.toDate(data.snapshot.date) : new Date(), Validators.required],
      stockValue: [data.snapshot?.stockValue ?? 0, [Validators.required, Validators.min(0)]],
    });
  }

  async ngOnInit() {
    if (!this.isEdit) {
      // Pre-fill with current calculated holding valuation when adding for "today"
      await this.prefillForm();
    }
  }

  private async prefillForm() {
    const { accountId } = this.data;
    
    // We want the most recent "Calculated" stock value to help the user.
    // PortfolioSnapshot has holding data.
    const snapshot = await firstValueFrom(this.portfolioService.getPortfolioSnapshot(accountId));
    
    const calculatedStockValue = snapshot.holdings.reduce((sum, h) => sum + (h.currentValue ?? 0), 0);
    
    this.form.patchValue({
      stockValue: Math.round(calculatedStockValue * 100) / 100
    });
  }

  onSave() {
    if (this.form.valid) {
      this.dialogRef.close(this.form.value);
    }
  }

  onCancel() {
    this.dialogRef.close();
  }

  private toDate(value: any): Date | undefined {
    if (value instanceof Date) return value;
    if (value?.toDate) return value.toDate();
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    return undefined;
  }
}
