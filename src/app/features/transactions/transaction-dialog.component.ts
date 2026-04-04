import { Component, Inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { Transaction, TransactionType } from '../../core/models/transaction.model';
import { TrackedSymbol } from '../../core/models/tracked-symbol.model';
import { SymbolCatalogService } from '../../core/services/symbol-catalog.service';
import { SymbolDialogComponent } from '../symbols/symbol-dialog.component';

interface TransactionDialogData {
  accountId: string;
  accountCurrency: string;
  symbols: TrackedSymbol[];
  transaction?: Transaction;
}

export interface TransactionDialogResult {
  symbol: string;
  type: TransactionType;
  date: Date;
  quantity: number;
  price: number;
  fees?: number;
  currency: string;
}

@Component({
    selector: 'app-transaction-dialog',
    imports: [
        ReactiveFormsModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatButtonModule,
    ],
    templateUrl: './transaction-dialog.component.html',
    styleUrl: './transaction-dialog.component.scss'
})
export class TransactionDialogComponent {
  private static readonly CREATE_SYMBOL_OPTION = '__CREATE_NEW_SYMBOL__';

  private readonly dialogData: TransactionDialogData;

  readonly isEditMode: boolean;
  symbols: TrackedSymbol[];

  readonly form;
  symbolMessage = '';
  isCreatingSymbol = false;

  constructor(
    private readonly fb: FormBuilder,
    private readonly dialog: MatDialog,
    private readonly symbolCatalogService: SymbolCatalogService,
    private readonly dialogRef: MatDialogRef<TransactionDialogComponent, TransactionDialogResult>,
    @Inject(MAT_DIALOG_DATA) data: TransactionDialogData | null
  ) {
    this.dialogData = data ?? { accountId: '', accountCurrency: 'USD', symbols: [] };
    this.isEditMode = !!this.dialogData.transaction;
    this.symbols = this.buildSymbols(this.dialogData.symbols, this.dialogData.transaction?.symbol);

    this.form = this.fb.nonNullable.group({
      symbol: [
        this.dialogData.transaction?.symbol ?? '',
        [Validators.required, Validators.maxLength(20)],
      ],
      type: [this.dialogData.transaction?.type ?? 'buy' as TransactionType, [Validators.required]],
      date: [this.toInputDate(this.dialogData.transaction?.date), [Validators.required]],
      quantity: [this.dialogData.transaction?.quantity ?? 1, [Validators.required, Validators.min(0.000001)]],
      price: [this.dialogData.transaction?.price ?? 0, [Validators.required, Validators.min(0)]],
      fees: [this.dialogData.transaction?.fees ?? 0, [Validators.min(0)]],
    });
  }

  get accountCurrency(): string {
    return this.dialogData.accountCurrency;
  }

  get totalPrice(): number {
    const value = this.form.getRawValue();
    return Number(value.quantity) * Number(value.price);
  }

  get totalCost(): number {
    const value = this.form.getRawValue();
    return this.totalPrice + Number(value.fees || 0);
  }

  async onSymbolSelectionChanged(selectedSymbol: string): Promise<void> {
    if (selectedSymbol !== TransactionDialogComponent.CREATE_SYMBOL_OPTION) {
      return;
    }

    this.form.controls.symbol.setValue('');
    await this.openCreateSymbolDialog();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.dialogRef.close({
      symbol: value.symbol.trim().toUpperCase(),
      type: value.type,
      date: new Date(`${value.date}T12:00:00`),
      quantity: Number(value.quantity),
      price: Number(value.price),
      fees: Number(value.fees || 0),
      currency: this.accountCurrency,
    });
  }

  async openCreateSymbolDialog(): Promise<void> {
    if (this.isCreatingSymbol || !this.dialogData.accountId) {
      return;
    }

    this.symbolMessage = '';

    const result = await firstValueFrom(
      this.dialog
        .open(SymbolDialogComponent, {
          width: '520px',
          data: {
            accountCurrency: this.accountCurrency,
          },
        })
        .afterClosed()
    );

    if (!result) {
      return;
    }

    const normalizedSymbol = result.symbol.trim().toUpperCase();
    const existing = this.symbols.find(symbol => symbol.symbol.toUpperCase() === normalizedSymbol);
    if (existing) {
      this.form.controls.symbol.setValue(existing.symbol);
      this.symbolMessage = `${existing.symbol} already exists and was selected.`;
      return;
    }

    this.isCreatingSymbol = true;
    try {
      await this.symbolCatalogService.addSymbol(this.dialogData.accountId, {
        symbol: result.symbol,
        fullName: result.fullName,
      });

      const createdSymbol: TrackedSymbol = {
        id: `new-${normalizedSymbol}`,
        accountId: this.dialogData.accountId,
        symbol: normalizedSymbol,
        fullName: result.fullName.trim(),
      };

      this.symbols = [...this.symbols, createdSymbol].sort((a, b) => a.symbol.localeCompare(b.symbol));
      this.form.controls.symbol.setValue(createdSymbol.symbol);
      this.symbolMessage = `Created ${createdSymbol.symbol}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.symbolMessage = `Could not create symbol: ${message}`;
    } finally {
      this.isCreatingSymbol = false;
    }
  }

  private buildSymbols(symbols: TrackedSymbol[], currentSymbol?: string): TrackedSymbol[] {
    const normalized = symbols
      .map(symbol => ({
        ...symbol,
        symbol: symbol.symbol.trim().toUpperCase(),
        fullName: symbol.fullName.trim(),
      }))
      .filter(symbol => !!symbol.symbol);

    const uniqueBySymbol = new Map<string, TrackedSymbol>();
    for (const symbol of normalized) {
      if (!uniqueBySymbol.has(symbol.symbol)) {
        uniqueBySymbol.set(symbol.symbol, symbol);
      }
    }

    const existingSymbol = currentSymbol?.trim().toUpperCase();
    if (existingSymbol && !uniqueBySymbol.has(existingSymbol)) {
      uniqueBySymbol.set(existingSymbol, {
        id: `legacy-${existingSymbol}`,
        accountId: '',
        symbol: existingSymbol,
        fullName: 'Not in symbol list yet',
      });
    }

    return [...uniqueBySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
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
