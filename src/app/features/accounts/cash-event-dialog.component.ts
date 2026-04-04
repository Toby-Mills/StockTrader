import { Component, Inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CashEvent, CashEventType } from '../../core/models/cash-event.model';

interface CashEventDialogData {
  accountCurrency: string;
  cashEvent?: CashEvent;
}

export interface CashEventDialogResult {
  type: CashEventType;
  date: Date;
  amount: number;
  currency: string;
  notes?: string;
}

@Component({
  selector: 'app-cash-event-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  templateUrl: './cash-event-dialog.component.html',
  styleUrl: './cash-event-dialog.component.scss',
})
export class CashEventDialogComponent {
  private readonly dialogData: CashEventDialogData;

  readonly isEditMode: boolean;
  readonly form;

  constructor(
    private readonly fb: FormBuilder,
    private readonly dialogRef: MatDialogRef<CashEventDialogComponent, CashEventDialogResult>,
    @Inject(MAT_DIALOG_DATA) data: CashEventDialogData | null
  ) {
    this.dialogData = data ?? { accountCurrency: 'USD' };
    this.isEditMode = !!this.dialogData.cashEvent;

    this.form = this.fb.nonNullable.group({
      type: [this.dialogData.cashEvent?.type ?? 'deposit' as CashEventType, [Validators.required]],
      date: [this.toInputDate(this.dialogData.cashEvent?.date), [Validators.required]],
      amount: [this.dialogData.cashEvent?.amount ?? 0, [Validators.required, Validators.min(0.000001)]],
      notes: [this.dialogData.cashEvent?.notes ?? '', [Validators.maxLength(500)]],
    });
  }

  get accountCurrency(): string {
    return this.dialogData.accountCurrency;
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.dialogRef.close({
      type: value.type,
      date: new Date(`${value.date}T12:00:00`),
      amount: Number(value.amount),
      currency: this.accountCurrency,
      notes: value.notes?.trim() || undefined,
    });
  }

  private toInputDate(rawDate: unknown): string {
    const date = this.toDate(rawDate) ?? new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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
}
