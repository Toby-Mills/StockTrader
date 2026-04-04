import { Component, Inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { DividendType } from '../../core/models/dividend-type.model';

interface DividendTypeDialogData {
  type?: DividendType;
}

export interface DividendTypeDialogResult {
  name: string;
  description?: string;
}

@Component({
  selector: 'app-dividend-type-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './dividend-type-dialog.component.html',
  styleUrl: './dividend-type-dialog.component.scss',
})
export class DividendTypeDialogComponent {
  private readonly dialogData: DividendTypeDialogData;
  readonly isEditMode: boolean;
  readonly form;

  constructor(
    private readonly fb: FormBuilder,
    private readonly dialogRef: MatDialogRef<DividendTypeDialogComponent, DividendTypeDialogResult>,
    @Inject(MAT_DIALOG_DATA) data: DividendTypeDialogData | null
  ) {
    this.dialogData = data ?? {};
    this.isEditMode = !!this.dialogData.type;

    this.form = this.fb.nonNullable.group({
      name: [
        this.dialogData.type?.name ?? '',
        [Validators.required, Validators.maxLength(80)],
      ],
      description: [
        this.dialogData.type?.description ?? '',
        [Validators.maxLength(200)],
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
      name: value.name.trim(),
      description: value.description?.trim() || undefined,
    });
  }
}
