import { Component, Inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { Dividend } from '../../core/models/dividend.model';
import { DividendType } from '../../core/models/dividend-type.model';
import { TrackedSymbol } from '../../core/models/tracked-symbol.model';
import { DividendTypeService } from '../../core/services/dividend-type.service';
import { SymbolCatalogService } from '../../core/services/symbol-catalog.service';
import { SymbolDialogComponent } from '../symbols/symbol-dialog.component';

interface DividendDialogData {
  accountId: string;
  accountCurrency: string;
  symbols: TrackedSymbol[];
  dividendTypes: DividendType[];
  dividend?: Dividend;
}

export interface DividendDialogResult {
  symbol: string;
  dividendTypeId: string;
  date: Date;
  amount: number;
  perShare?: number;
  sharesHeld?: number;
  currency: string;
  notes?: string;
}

@Component({
    standalone: true,
    selector: 'app-dividend-dialog',
    imports: [
        ReactiveFormsModule,
        MatAutocompleteModule,
        MatDatepickerModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatButtonModule,
    ],
    templateUrl: './dividend-dialog.component.html',
    styleUrl: './dividend-dialog.component.scss'
})
export class DividendDialogComponent {
  private static readonly CREATE_SYMBOL_OPTION = '__CREATE_NEW_SYMBOL__';

  private readonly dialogData: DividendDialogData;

  readonly isEditMode: boolean;
  symbols: TrackedSymbol[];
  dividendTypes: DividendType[];
  readonly form;
  isSavingType = false;
  isCreatingSymbol = false;
  symbolMessage = '';

  constructor(
    private readonly fb: FormBuilder,
    private readonly dialog: MatDialog,
    private readonly dividendTypeService: DividendTypeService,
    private readonly symbolCatalogService: SymbolCatalogService,
    private readonly dialogRef: MatDialogRef<DividendDialogComponent, DividendDialogResult>,
    @Inject(MAT_DIALOG_DATA) data: DividendDialogData | null
  ) {
    this.dialogData = {
      accountId: data?.accountId ?? '',
      accountCurrency: data?.accountCurrency ?? 'USD',
      symbols: data?.symbols ?? [],
      dividendTypes: data?.dividendTypes ?? [],
      dividend: data?.dividend,
    };
    this.isEditMode = !!this.dialogData.dividend;
    this.symbols = this.buildSymbols(this.dialogData.symbols, this.dialogData.dividend?.symbol);
    this.dividendTypes = this.buildDividendTypes(this.dialogData.dividendTypes, this.dialogData.dividend?.dividendTypeId);

    this.form = this.fb.nonNullable.group({
      symbol: [
        this.dialogData.dividend?.symbol ?? '',
        [Validators.required, Validators.maxLength(20)],
      ],
      dividendTypeName: [
        this.resolveInitialDividendTypeName(),
        [Validators.required],
      ],
      date: [this.toDate(this.dialogData.dividend?.date) ?? new Date(), [Validators.required]],
      amount: [this.dialogData.dividend?.amount ?? 0, [Validators.required]],
      perShare: [this.dialogData.dividend?.perShare ?? null],
      sharesHeld: [this.dialogData.dividend?.sharesHeld ?? 0, [Validators.min(0)]],
      notes: [this.dialogData.dividend?.notes ?? '', [Validators.maxLength(500)]],
    });
  }

  get accountCurrency(): string {
    return this.dialogData.accountCurrency;
  }

  filteredSymbols(): TrackedSymbol[] {
    const query = this.form.controls.symbol.value.trim().toLowerCase();
    if (!query) {
      return this.symbols;
    }

    return this.symbols.filter(sym => 
      sym.symbol.toLowerCase().includes(query) || 
      sym.fullName.toLowerCase().includes(query)
    );
  }

  async openSymbolCreateOption(): Promise<void> {
    this.form.controls.symbol.setValue('');
    await this.openCreateSymbolDialog();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSavingType = true;

    const value = this.form.getRawValue();
    try {
      const dividendTypeId = await this.resolveDividendTypeId(value.dividendTypeName);

      this.dialogRef.close({
        symbol: value.symbol.trim().toUpperCase(),
        dividendTypeId,
        date: this.toNoonDate(value.date),
        amount: Number(value.amount),
        perShare: value.perShare == null ? undefined : Number(value.perShare),
        sharesHeld: Number(value.sharesHeld || 0),
        currency: this.accountCurrency,
        notes: value.notes?.trim() || undefined,
      });
    } finally {
      this.isSavingType = false;
    }
  }

  filteredDividendTypes(): DividendType[] {
    const control = this.form.controls.dividendTypeName;
    const query = control.value.trim().toLowerCase();

    if (!query || control.pristine) {
      return this.dividendTypes;
    }

    return this.dividendTypes.filter(type => type.name.toLowerCase().includes(query));
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

  private buildDividendTypes(types: DividendType[] | undefined, currentTypeId?: string): DividendType[] {
    const normalized = (types ?? [])
      .map(type => ({
        ...type,
        name: type.name.trim(),
        description: type.description?.trim() || undefined,
      }))
      .filter(type => !!type.name);

    const sorted = [...normalized].sort((a, b) => a.name.localeCompare(b.name));

    if (currentTypeId && !sorted.some(type => type.id === currentTypeId)) {
      sorted.unshift({
        id: currentTypeId,
        accountId: '',
        name: 'Deleted type (legacy)',
        description: undefined,
      });
    }

    return sorted;
  }

  private resolveInitialDividendTypeName(): string {
    const existingTypeId = this.dialogData.dividend?.dividendTypeId;
    if (!existingTypeId) {
      return this.dividendTypes[0]?.name ?? '';
    }

    const existingType = this.dividendTypes.find(type => type.id === existingTypeId);
    if (existingType) {
      return existingType.name;
    }

    return this.dividendTypes[0]?.name ?? '';
  }

  private async resolveDividendTypeId(typeNameInput: string): Promise<string> {
    const typeName = typeNameInput.trim();
    const existing = this.findDividendTypeByName(typeName);
    if (existing) {
      return existing.id;
    }

    const createdId = await this.dividendTypeService.addDividendType(this.dialogData.accountId, {
      name: typeName,
      description: undefined,
    });

    this.dividendTypes = this.sortDividendTypes([
      ...this.dividendTypes,
      {
        id: createdId,
        accountId: this.dialogData.accountId,
        name: typeName,
        description: undefined,
      },
    ]);

    return createdId;
  }

  private findDividendTypeByName(name: string): DividendType | undefined {
    const normalized = name.trim().toLowerCase();
    return this.dividendTypes.find(type => type.name.trim().toLowerCase() === normalized);
  }

  private sortDividendTypes(types: DividendType[]): DividendType[] {
    return [...types].sort((a, b) => a.name.localeCompare(b.name));
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
