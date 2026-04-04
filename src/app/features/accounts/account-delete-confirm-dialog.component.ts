import { Component, Inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

interface AccountDeleteConfirmDialogData {
  accountName: string;
  relatedRecordCount: number;
}

@Component({
    standalone: true,
    selector: 'app-account-delete-confirm-dialog',
    imports: [MatDialogModule, MatButtonModule, MatIconModule],
    templateUrl: './account-delete-confirm-dialog.component.html',
    styleUrl: './account-delete-confirm-dialog.component.scss'
})
export class AccountDeleteConfirmDialogComponent {
  readonly accountName: string;
  readonly relatedRecordCount: number;

  constructor(
    private readonly dialogRef: MatDialogRef<AccountDeleteConfirmDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) data: AccountDeleteConfirmDialogData | null
  ) {
    this.accountName = data?.accountName?.trim() || 'this account';
    this.relatedRecordCount = data?.relatedRecordCount ?? 0;
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  confirmDelete(): void {
    this.dialogRef.close(true);
  }
}
