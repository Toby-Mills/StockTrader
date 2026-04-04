import { Component, Inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TrackedSymbol } from '../../core/models/tracked-symbol.model';

interface SymbolDialogData {
  accountCurrency: string;
  symbol?: TrackedSymbol;
}

export interface SymbolDialogResult {
  symbol: string;
  fullName: string;
}

@Component({
    standalone: true,
    selector: 'app-symbol-dialog',
    imports: [
        ReactiveFormsModule,
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
      fullName: value.fullName.trim(),
    });
  }
}