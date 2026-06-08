import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { BaseChartDirective } from 'ng2-charts';
import {
  Chart,
  ChartConfiguration,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  LineController,
  Filler,
  TimeScale
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { AccountHistoryService } from '../../../core/services/account-history.service';
import { PortfolioService } from '../../../core/services/portfolio.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { DividendService } from '../../../core/services/dividend.service';
import { CashEventService } from '../../../core/services/cash-event.service';
import { AccountSnapshot } from '../../../core/models/account-snapshot.model';
import { combineLatest, map, switchMap } from 'rxjs';
import { AccountSnapshotDialogComponent } from '../account-snapshot-dialog/account-snapshot-dialog.component';

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  LineController,
  Filler,
  TimeScale
);

@Component({
  selector: 'app-account-history',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatDialogModule,
    BaseChartDirective
  ],
  templateUrl: './account-history.component.html',
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .chart-container {
      position: relative;
      height: 400px;
      width: 100%;
      min-width: 0;
      overflow: hidden;
      margin-bottom: 2rem;
      padding: 1rem;
      background: white;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 10px;
    }
    canvas {
      display: block;
      width: 100%;
    }
    .history-toolbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 1rem;
    }
    .snapshot-list {
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 10px;
      overflow: hidden;
    }
    .section-header {
      padding: 0.85rem 1rem;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      background: rgba(0, 0, 0, 0.01);
      h3 { margin: 0; }
    }
    .table-wrap {
      overflow-x: auto;
    }
    .snapshot-table {
      width: 100%;
    }
    .numeric-col {
      text-align: right !important;
    }
    .empty-state, .loading-state {
      padding: 2rem;
      text-align: center;
      color: rgba(0, 0, 0, 0.65);
      margin: 0;
    }
  `,
})
export class AccountHistoryComponent implements OnChanges {
  @Input({ required: true }) accountId!: string;
  @Input({ required: true }) currency!: string;

  private readonly accountHistoryService = inject(AccountHistoryService);
  private readonly portfolioService = inject(PortfolioService);
  private readonly transactionService = inject(TransactionService);
  private readonly dividendService = inject(DividendService);
  private readonly cashEventService = inject(CashEventService);
  private readonly dialog = inject(MatDialog);

  private readonly accountIdSignal = signal('');
  private readonly accountId$ = toObservable(this.accountIdSignal);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['accountId'] && changes['accountId'].currentValue) {
      this.accountIdSignal.set(changes['accountId'].currentValue);
    }
  }

  private readonly historyData$ = this.accountId$.pipe(
    switchMap(id => combineLatest([
      this.accountHistoryService.getSnapshots(id),
      this.transactionService.getTransactions(id),
      this.dividendService.getDividends(id),
      this.cashEventService.getCashEvents(id),
    ])),
    map(([snapshots, transactions, dividends, cashEvents]) => {
      // Sort snapshots by date ascending for the chart
      const sortedSnapshots = [...snapshots].sort((a, b) => {
        const dateA = this.toDate(a.date);
        const dateB = this.toDate(b.date);
        return (dateA?.getTime() ?? 0) - (dateB?.getTime() ?? 0);
      });
      
      const accountValueData: { x: any; y: number }[] = [];
      const investedAmountData: { x: any; y: number }[] = [];

      for (const snapshot of sortedSnapshots) {
        const date = this.toDate(snapshot.date);
        if (!date) continue;

        const cashBalance = this.portfolioService.computeCashBalance(transactions, dividends, cashEvents, date);
        const investedAmount = this.portfolioService.computeInvestedAmount(cashEvents, date);
        
        accountValueData.push({ x: date, y: snapshot.stockValue + cashBalance });
        investedAmountData.push({ x: date, y: investedAmount });
      }

      const snapshotsWithCalculations = snapshots.map(snapshot => {
        const date = this.toDate(snapshot.date);
        const cashBalance = date ? this.portfolioService.computeCashBalance(transactions, dividends, cashEvents, date) : 0;
        const investedAmount = date ? this.portfolioService.computeInvestedAmount(cashEvents, date) : 0;
        
        return {
          ...snapshot,
          cashBalance,
          investedAmount,
          totalAccountValue: snapshot.stockValue + cashBalance
        };
      });

      return {
        snapshots: snapshotsWithCalculations,
        chartData: {
          datasets: [
            {
              data: accountValueData,
              label: 'Account Value',
              borderColor: '#3f51b5',
              backgroundColor: 'rgba(63, 81, 181, 0.1)',
              fill: 'origin',
              tension: 0.1
            },
            {
              data: investedAmountData,
              label: 'Total Invested',
              borderColor: '#ff4081',
              backgroundColor: 'transparent',
              borderDash: [5, 5],
              tension: 0.1
            }
          ]
        } as ChartConfiguration['data']
      };
    })
  );

  readonly historyState = toSignal(this.historyData$);

  readonly chartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 50,
    scales: {
      x: {
        type: 'time',
        time: {
          unit: 'month',
          displayFormats: {
            month: 'MMM yy'
          },
          tooltipFormat: 'dd/MM/yyyy'
        },
        title: {
          display: true,
          text: 'Date'
        }
      },
      y: {
        beginAtZero: true,
        ticks: {
          callback: (value) => {
            return new Intl.NumberFormat('en-GB', {
              style: 'currency',
              currency: this.currency,
              maximumFractionDigits: 0
            }).format(value as number);
          }
        }
      }
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (context.parsed.y !== null) {
              label += new Intl.NumberFormat('en-GB', {
                style: 'currency',
                currency: this.currency
              }).format(context.parsed.y);
            }
            return label;
          }
        }
      }
    }
  };

  readonly displayedColumns: string[] = ['date', 'stockValue', 'cashBalance', 'totalAccountValue', 'investedAmount', 'actions'];

  onAddSnapshot() {
    this.dialog.open(AccountSnapshotDialogComponent, {
      width: '450px',
      data: {
        accountId: this.accountId,
        currency: this.currency
      }
    }).afterClosed().subscribe(async result => {
      if (result) {
        await this.accountHistoryService.addOrUpdateSnapshot(this.accountId, {
          date: result.date,
          stockValue: result.stockValue
        });
      }
    });
  }

  onEditSnapshot(snapshot: AccountSnapshot) {
    this.dialog.open(AccountSnapshotDialogComponent, {
      width: '450px',
      data: {
        accountId: this.accountId,
        currency: this.currency,
        snapshot
      }
    }).afterClosed().subscribe(async result => {
      if (result) {
        await this.accountHistoryService.addOrUpdateSnapshot(this.accountId, {
          id: snapshot.id,
          date: result.date,
          stockValue: result.stockValue
        });
      }
    });
  }

  async onDeleteSnapshot(snapshot: AccountSnapshot) {
    if (confirm(`Are you sure you want to delete the snapshot from ${this.formatDate(snapshot.date)}?`)) {
      await this.accountHistoryService.deleteSnapshot(this.accountId, snapshot.id);
    }
  }

  formatDate(date: any): string {
    const d = this.toDate(date);
    if (!d) return '';
    
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(d);
  }

  formatMoney(amount: number): string {
    return new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  private toDate(value: any): Date | undefined {
    if (value instanceof Date) return value;
    if (value?.toDate) return value.toDate(); // Firestore Timestamp
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    return undefined;
  }
}
