/// <reference types="jasmine" />
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AccountHistoryComponent } from './account-history.component';
import { MatDialog } from '@angular/material/dialog';
import { AccountHistoryService } from '../../../core/services/account-history.service';
import { PortfolioService } from '../../../core/services/portfolio.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { DividendService } from '../../../core/services/dividend.service';
import { CashEventService } from '../../../core/services/cash-event.service';
import { of } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

describe('AccountHistoryComponent', () => {
  let component: AccountHistoryComponent;
  let fixture: ComponentFixture<AccountHistoryComponent>;

  const mockHistoryService = {
    getSnapshots: jasmine.createSpy('getSnapshots').and.returnValue(of([]))
  };
  const mockPortfolioService = {
    getPortfolioSnapshot: jasmine.createSpy('getPortfolioSnapshot').and.returnValue(of({ holdings: [] }))
  };
  const mockTransactionService = {
    getTransactions: jasmine.createSpy('getTransactions').and.returnValue(of([]))
  };
  const mockDividendService = {
    getDividends: jasmine.createSpy('getDividends').and.returnValue(of([]))
  };
  const mockCashEventService = {
    getCashEvents: jasmine.createSpy('getCashEvents').and.returnValue(of([]))
  };
  const mockDialog = {
    open: jasmine.createSpy('open')
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AccountHistoryComponent,
        NoopAnimationsModule
      ],
      providers: [
        { provide: AccountHistoryService, useValue: mockHistoryService },
        { provide: PortfolioService, useValue: mockPortfolioService },
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: DividendService, useValue: mockDividendService },
        { provide: CashEventService, useValue: mockCashEventService },
        { provide: MatDialog, useValue: mockDialog }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AccountHistoryComponent);
    component = fixture.componentInstance;
    // Set required input
    fixture.componentRef.setInput('accountId', 'test-acc');
    fixture.componentRef.setInput('currency', 'GBP');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

