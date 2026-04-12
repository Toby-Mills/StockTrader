import { Component, Inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { Transaction, TransactionType } from '../../core/models/transaction.model';
import { TrackedSymbol } from '../../core/models/tracked-symbol.model';
import { SymbolCatalogService } from '../../core/services/symbol-catalog.service';
import { TransactionFormPrefillPayload } from '../../core/models/transaction-import.model';
import { TransactionPdfImportError, TransactionPdfImportService } from '../../core/services/transaction-pdf-import.service';
import { SymbolDialogComponent } from '../symbols/symbol-dialog.component';

interface TransactionDialogData {
  accountId: string;
  accountCurrency: string;
  symbols: TrackedSymbol[];
  transaction?: Transaction;
}

interface ImportCommentsDialogData {
  comments: string[];
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
    standalone: true,
    selector: 'app-transaction-dialog',
    imports: [
        FormsModule,
        ReactiveFormsModule,
        MatDatepickerModule,
        MatDialogModule,
        MatFormFieldModule,
        MatIconModule,
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
  readonly availableModels = [
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ];
  selectedModel = 'gemini-2.5-flash-lite';
  symbolMessage = '';
  isCreatingSymbol = false;
  isImportingPdf = false;
  importMessage = '';
  importError: string | null = null;
  importErrorDiagnostics: string[] = [];
  importWarnings: string[] = [];
  private importedFields = new Set<string>();

  constructor(
    private readonly fb: FormBuilder,
    private readonly dialog: MatDialog,
    private readonly symbolCatalogService: SymbolCatalogService,
    private readonly transactionPdfImportService: TransactionPdfImportService,
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
      date: [this.toDate(this.dialogData.transaction?.date) ?? new Date(), [Validators.required]],
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

  openImportPicker(fileInput: HTMLInputElement): void {
    if (this.isImportingPdf) {
      return;
    }

    this.importMessage = '';
    this.importError = null;
    this.importErrorDiagnostics = [];
    this.importWarnings = [];
    fileInput.click();
  }

  async onPdfSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || this.isImportingPdf) {
      return;
    }

    this.setImportingState(true);
    this.importMessage = '';
    this.importError = null;
    this.importErrorDiagnostics = [];
    this.importWarnings = [];

    try {
      const result = await this.transactionPdfImportService.importSingleTransaction(file, this.accountCurrency, this.selectedModel, this.symbols);
      const parsed = result.parsedTransaction;

      if (!parsed) {
        throw new Error('No transaction data was extracted from the selected PDF.');
      }

      this.applyImportedPrefill(this.transactionPdfImportService.toFormPrefill(parsed));
      this.importWarnings = [...result.warnings, ...(result.diagnostics ?? [])];
      const confidence = Math.round(result.confidence * 100);
      this.importMessage = `Imported values were added to the form (confidence ${confidence}%). Review before saving.`;
    } catch (error) {
      if (error instanceof TransactionPdfImportError) {
        this.importErrorDiagnostics = error.diagnostics;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.importError = message;
    } finally {
      this.setImportingState(false);
      input.value = '';
    }
  }

  isFieldImported(fieldName: string): boolean {
    return this.importedFields.has(fieldName);
  }

  showErrorDetails(): void {
    if (!this.importError) {
      return;
    }

    this.dialog.open(ImportErrorDialogComponent, {
      width: '500px',
      data: {
        message: this.importError,
        diagnostics: this.importErrorDiagnostics,
      },
    });
  }

  showImportCommentsDetails(): void {
    if (!this.importWarnings.length) {
      return;
    }

    this.dialog.open(ImportCommentsDialogComponent, {
      width: '500px',
      data: {
        comments: this.importWarnings,
      },
    });
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
      date: this.toNoonDate(value.date),
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

  private toNoonDate(rawDate: unknown): Date {
    const date = this.toDate(rawDate) ?? new Date();
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  }

  private applyImportedPrefill(prefill: TransactionFormPrefillPayload): void {
    const patch: Partial<{
      symbol: string;
      type: TransactionType;
      date: Date;
      quantity: number;
      price: number;
      fees: number;
    }> = {};

    this.importedFields.clear();
    this.symbolMessage = '';

    if (prefill.symbol) {
      const normalizedSymbol = prefill.symbol.trim().toUpperCase();
      this.ensureImportedSymbolAvailable(normalizedSymbol);
      patch.symbol = normalizedSymbol;
      this.importedFields.add('symbol');
    } else if (prefill.fullName) {
      const matchedSymbol = this.findSymbolByFullName(prefill.fullName);
      if (matchedSymbol) {
        patch.symbol = matchedSymbol;
        this.importedFields.add('symbol');
        this.symbolMessage = `Matched imported name "${prefill.fullName}" to ${matchedSymbol}.`;
      } else {
        this.symbolMessage = `Imported name "${prefill.fullName}" did not match any tracked symbol. Please select one manually.`;
      }
    }

    if (prefill.type) {
      patch.type = prefill.type;
      this.importedFields.add('type');
    }

    if (prefill.transactionDate) {
      patch.date = this.toDate(prefill.transactionDate) ?? new Date();
      this.importedFields.add('date');
    }

    if (prefill.quantity !== undefined) {
      patch.quantity = prefill.quantity;
      this.importedFields.add('quantity');
    }

    if (prefill.price !== undefined) {
      patch.price = prefill.price;
      this.importedFields.add('price');
    }

    if (prefill.fees !== undefined) {
      patch.fees = prefill.fees;
      this.importedFields.add('fees');
    }

    this.form.patchValue(patch);
    this.form.markAsDirty();
  }

  private findSymbolByFullName(fullName: string): string | undefined {
    const normalizedFullName = this.normalizeName(fullName);
    if (!normalizedFullName) {
      return undefined;
    }

    const exactMatch = this.symbols.find(
      existing => this.normalizeName(existing.fullName) === normalizedFullName
    );
    if (exactMatch) {
      return exactMatch.symbol;
    }

    const partialMatch = this.symbols.find((existing) => {
      const normalizedExisting = this.normalizeName(existing.fullName);
      return (
        normalizedExisting.includes(normalizedFullName) || normalizedFullName.includes(normalizedExisting)
      );
    });

    return partialMatch?.symbol;
  }

  private normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toUpperCase();
  }

  private ensureImportedSymbolAvailable(symbol: string): void {
    const exists = this.symbols.some(existing => existing.symbol.toUpperCase() === symbol);
    if (exists) {
      return;
    }

    this.symbols = [
      ...this.symbols,
      {
        id: `imported-${symbol}`,
        accountId: this.dialogData.accountId,
        symbol,
        fullName: 'Imported symbol (not yet in catalog)',
      },
    ].sort((a, b) => a.symbol.localeCompare(b.symbol));
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

  private setImportingState(isImporting: boolean): void {
    this.isImportingPdf = isImporting;
    this.dialogRef.disableClose = isImporting;
  }
}

interface ImportErrorDialogData {
  message: string;
  diagnostics?: string[];
}

@Component({
  standalone: true,
  selector: 'app-import-error-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Import Error</h2>
    <mat-dialog-content>
      <p class="error-message">{{ data.message }}</p>
      @if (filteredDiagnostics.length) {
        <div class="diagnostics">
          <p class="diagnostics-label">Details:</p>
          <ul class="diagnostics-list">
            @for (diag of filteredDiagnostics; track diag) {
              <li>{{ diag }}</li>
            }
          </ul>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .error-message {
      word-break: break-word;
      font-family: monospace;
      font-size: 0.9rem;
      padding: 0.5rem;
      background-color: rgba(244, 67, 54, 0.1);
      border-left: 4px solid #f44336;
      border-radius: 2px;
      margin: 0 0 1rem 0;
    }

    .diagnostics {
      margin-top: 1rem;
    }

    .diagnostics-label {
      font-weight: 500;
      font-size: 0.9rem;
      margin: 0 0 0.5rem 0;
    }

    .diagnostics-list {
      margin: 0;
      padding-left: 1.5rem;
      font-size: 0.85rem;
    }

    .diagnostics-list li {
      margin-bottom: 0.25rem;
      word-break: break-word;
    }
  `]
})
class ImportErrorDialogComponent {
  readonly filteredDiagnostics: string[];

  constructor(@Inject(MAT_DIALOG_DATA) readonly data: ImportErrorDialogData) {
    this.filteredDiagnostics = (data.diagnostics ?? []).filter(diag => !diag.startsWith('Error message:'));
  }
}

@Component({
  standalone: true,
  selector: 'app-import-comments-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Import Comments</h2>
    <mat-dialog-content>
      <ul class="comments-list">
        @for (comment of data.comments; track comment) {
          <li>{{ comment }}</li>
        }
      </ul>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .comments-list {
      margin: 0;
      padding-left: 1.25rem;
      font-size: 0.9rem;
    }

    .comments-list li {
      margin-bottom: 0.5rem;
      word-break: break-word;
    }
  `]
})
class ImportCommentsDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) readonly data: ImportCommentsDialogData) {}
}
