/// <reference types="jasmine" />
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AccountSnapshotDialogComponent } from './account-snapshot-dialog.component';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { PortfolioService } from '../../../core/services/portfolio.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { DividendService } from '../../../core/services/dividend.service';
import { CashEventService } from '../../../core/services/cash-event.service';
import { of } from 'rxjs';
import { provideNativeDateAdapter } from '@angular/material/core';

describe('AccountSnapshotDialogComponent', () => {
  let component: AccountSnapshotDialogComponent;
  let fixture: ComponentFixture<AccountSnapshotDialogComponent>;

  const mockPortfolioService = {
    getPortfolioSnapshot: jasmine.createSpy('getPortfolioSnapshot').and.returnValue(of({ holdings: [] }))
  };
  const mockTransactionService = {};
  const mockDividendService = {};
  const mockCashEventService = {};
  const mockDialogRef = {
    close: jasmine.createSpy('close')
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AccountSnapshotDialogComponent,
        NoopAnimationsModule
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { accountId: 'test-acc', currency: 'GBP' } },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: PortfolioService, useValue: mockPortfolioService },
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: DividendService, useValue: mockDividendService },
        { provide: CashEventService, useValue: mockCashEventService },
        provideNativeDateAdapter()
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountSnapshotDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

