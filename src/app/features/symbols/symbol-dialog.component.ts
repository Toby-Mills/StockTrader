import { Component, Inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TrackedSymbol } from '../../core/models/tracked-symbol.model';

interface SymbolDialogManualQuote {
  price: number;
  currency: string;
  asOf: Date;
}

interface SymbolDialogData {
  accountCurrency: string;
  symbol?: TrackedSymbol;
  manualQuote?: SymbolDialogManualQuote;
}

export interface SymbolDialogResult {
  symbol: string;
  fullName: string;
  manualQuote?: SymbolDialogManualQuote;
}

@Component({
    standalone: true,
    selector: 'app-symbol-dialog',
    imports: [
        ReactiveFormsModule,
      MatDatepickerModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
    ],
    templateUrl: './symbol-dialog.component.html',
    styleUrl: './symbol-dialog.component.scss'
})
export class SymbolDialogComponent {
  private readonly dialogData: SymbolDialogData;
  readonly isEditMode: boolean;
  readonly form;

  constructor(
    private readonly fb: FormBuilder,
    private readonly dialogRef: MatDialogRef<SymbolDialogComponent, SymbolDialogResult>,
    @Inject(MAT_DIALOG_DATA) data: SymbolDialogData | null
  ) {
    this.dialogData = data ?? { accountCurrency: 'USD' };
    this.isEditMode = !!this.dialogData.symbol;

    this.form = this.fb.nonNullable.group({
      symbol: [
        this.dialogData.symbol?.symbol ?? '',
        [Validators.required, Validators.maxLength(20)],
      ],
      fullName: [
        this.dialogData.symbol?.fullName ?? '',
        [Validators.required, Validators.maxLength(120)],
      ],
      manualQuotePrice: [
        this.dialogData.manualQuote?.price != null ? String(this.dialogData.manualQuote.price) : '',
        [Validators.min(0)],
      ],
      manualQuoteCurrency: [
        this.dialogData.manualQuote?.currency ?? this.dialogData.accountCurrency,
        [Validators.maxLength(8)],
      ],
      manualQuoteAsOf: [
        this.toDate(this.dialogData.manualQuote?.asOf) ?? new Date(),
      ],
    });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const manualQuotePriceText = typeof value.manualQuotePrice === 'string'
      ? value.manualQuotePrice.trim()
      : String(value.manualQuotePrice ?? '').trim();
    const parsedPrice = manualQuotePriceText === ''
      ? null
      : Number(manualQuotePriceText);
    const hasManualQuote = parsedPrice != null && Number.isFinite(parsedPrice);

    if (manualQuotePriceText !== '' && !Number.isFinite(parsedPrice)) {
      this.form.controls.manualQuotePrice.setErrors({ invalidNumber: true });
      this.form.controls.manualQuotePrice.markAsTouched();
      return;
    }

    const asOf = this.toNoonDate(value.manualQuoteAsOf);

    if (hasManualQuote && Number.isNaN(asOf.getTime())) {
      this.form.controls.manualQuoteAsOf.setErrors({ invalidDate: true });
      this.form.controls.manualQuoteAsOf.markAsTouched();
      return;
    }

    this.dialogRef.close({
      symbol: value.symbol.trim().toUpperCase(),
      fullName: value.fullName.trim(),
      manualQuote: hasManualQuote
        ? {
            price: parsedPrice,
            currency: value.manualQuoteCurrency.trim().toUpperCase() || this.dialogData.accountCurrency,
            asOf,
          }
        : undefined,
    });
  }

  private toNoonDate(rawDate: unknown): Date {
    const date = this.toDate(rawDate) ?? new Date();
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
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