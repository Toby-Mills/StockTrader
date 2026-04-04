import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { TransactionService } from './transaction.service';
import { DividendService } from './dividend.service';
import { CashEventService } from './cash-event.service';
import { Transaction } from '../models/transaction.model';
import { Holding } from '../models/holding.model';
import { Dividend } from '../models/dividend.model';
import { FinancialCalculationsService } from './financial-calculations.service';
import { CashEvent } from '../models/cash-event.model';

export interface PortfolioSnapshot {
  holdings: Holding[];
  cashBalance: number;
}

@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private transactionService = inject(TransactionService);
  private dividendService = inject(DividendService);
  private cashEventService = inject(CashEventService);
  private financialCalculations = inject(FinancialCalculationsService);

  /** Compute current holdings from the full transaction history for one account. */
  getHoldings(accountId: string): Observable<Holding[]> {
    return this.getPortfolioSnapshot(accountId).pipe(map(snapshot => snapshot.holdings));
  }

  getCashBalance(accountId: string): Observable<number> {
    return this.getPortfolioSnapshot(accountId).pipe(map(snapshot => snapshot.cashBalance));
  }

  getPortfolioSnapshot(accountId: string): Observable<PortfolioSnapshot> {
    return combineLatest([
      this.transactionService.getTransactions(accountId),
      this.dividendService.getDividends(accountId),
      this.cashEventService.getCashEvents(accountId),
    ]).pipe(
      map(([transactions, dividends, cashEvents]) => {
        const holdings = this.computeHoldings(accountId, transactions, dividends);
        const cashBalance = this.computeCashBalance(transactions, dividends, cashEvents);
        return { holdings, cashBalance };
      })
    );
  }

  private computeHoldings(
    accountId: string,
    transactions: Transaction[],
    dividends: Dividend[]
  ): Holding[] {
    const positionBySymbol = new Map<string, { qty: number; cost: number; currency: string }>();
    const transactionsBySymbol = new Map<string, Transaction[]>();
    const dividendsBySymbol = new Map<string, Dividend[]>();
    const totalDividendsBySymbol = dividends.reduce((acc, d) => {
      acc[d.symbol] = (acc[d.symbol] ?? 0) + d.amount;
      return acc;
    }, {} as Record<string, number>);

    for (const tx of transactions) {
      const list = transactionsBySymbol.get(tx.symbol) ?? [];
      list.push(tx);
      transactionsBySymbol.set(tx.symbol, list);
    }

    for (const div of dividends) {
      const list = dividendsBySymbol.get(div.symbol) ?? [];
      list.push(div);
      dividendsBySymbol.set(div.symbol, list);
    }

    const transactionsChronological = transactions
      .map((tx, originalIndex) => ({ tx, originalIndex }))
      .sort((a, b) => {
        const dateDelta = this.toTimestamp(a.tx.date) - this.toTimestamp(b.tx.date);
        if (dateDelta !== 0) {
          return dateDelta;
        }

        const createdAtA = this.toTimestamp(a.tx.createdAt, Number.NaN);
        const createdAtB = this.toTimestamp(b.tx.createdAt, Number.NaN);
        const bothHaveCreatedAt = Number.isFinite(createdAtA) && Number.isFinite(createdAtB);
        if (bothHaveCreatedAt && createdAtA !== createdAtB) {
          return createdAtA - createdAtB;
        }

        // Fallback for legacy rows without createdAt: preserve source order.
        return a.originalIndex - b.originalIndex;
      })
      .map(entry => entry.tx);

    // Process transactions chronologically (oldest first)
    transactionsChronological.forEach(tx => {
      const existing = positionBySymbol.get(tx.symbol) ?? { qty: 0, cost: 0, currency: tx.currency };
      if (tx.type === 'buy') {
        existing.cost += tx.quantity * tx.price + (tx.fees ?? 0);
        existing.qty  += tx.quantity;
      } else {
        const avgCost = existing.qty > 0 ? existing.cost / existing.qty : 0;
        existing.cost -= avgCost * tx.quantity;
        existing.qty  -= tx.quantity;
      }
      positionBySymbol.set(tx.symbol, existing);
    });

    return Array.from(positionBySymbol.entries()).map(([symbol, { qty, cost, currency }]) => {
      const symbolTransactions = transactionsBySymbol.get(symbol) ?? [];
      const grossBuyAmount = symbolTransactions
        .filter(tx => tx.type === 'buy')
        .reduce((sum, tx) => sum + tx.quantity * tx.price + (tx.fees ?? 0), 0);
      const grossSellAmount = symbolTransactions
        .filter(tx => tx.type === 'sell')
        .reduce((sum, tx) => sum + tx.quantity * tx.price - (tx.fees ?? 0), 0);

      return {
      symbol,
      accountId,
      quantity: qty,
      averageCost: qty > 0 ? cost / qty : 0,
      totalCost: cost,
      currency,
      grossBuyAmount,
      grossSellAmount,
      netInvestedAmount: grossBuyAmount - grossSellAmount,
      totalDividends: totalDividendsBySymbol[symbol] ?? 0,
      effectiveAnnualGrowthRate: this.financialCalculations.calculateEffectiveAnnualGrowthRate(
        symbolTransactions,
        dividendsBySymbol.get(symbol) ?? [],
        cost
      ),
    };
    });
  }

  private computeCashBalance(
    transactions: Transaction[],
    dividends: Dividend[],
    cashEvents: CashEvent[]
  ): number {
    type LedgerEvent =
      | { source: 'transaction'; date: unknown; createdAt?: unknown; originalIndex: number; transaction: Transaction }
      | { source: 'dividend'; date: unknown; createdAt?: unknown; originalIndex: number; dividend: Dividend }
      | { source: 'cash-event'; date: unknown; createdAt?: unknown; originalIndex: number; cashEvent: CashEvent };

    const events: LedgerEvent[] = [
      ...transactions.map((transaction, originalIndex) => ({
        source: 'transaction' as const,
        date: transaction.date,
        createdAt: transaction.createdAt,
        originalIndex,
        transaction,
      })),
      ...dividends.map((dividend, originalIndex) => ({
        source: 'dividend' as const,
        date: dividend.date,
        createdAt: undefined,
        originalIndex,
        dividend,
      })),
      ...cashEvents.map((cashEvent, originalIndex) => ({
        source: 'cash-event' as const,
        date: cashEvent.date,
        createdAt: cashEvent.createdAt,
        originalIndex,
        cashEvent,
      })),
    ];

    events.sort((a, b) => {
      const dateDelta = this.toTimestamp(a.date) - this.toTimestamp(b.date);
      if (dateDelta !== 0) {
        return dateDelta;
      }

      const createdAtA = this.toTimestamp(a.createdAt, Number.NaN);
      const createdAtB = this.toTimestamp(b.createdAt, Number.NaN);
      const bothHaveCreatedAt = Number.isFinite(createdAtA) && Number.isFinite(createdAtB);
      if (bothHaveCreatedAt && createdAtA !== createdAtB) {
        return createdAtA - createdAtB;
      }

      return a.originalIndex - b.originalIndex;
    });

    let cashBalance = 0;
    for (const event of events) {
      if (event.source === 'transaction') {
        const tx = event.transaction;
        const gross = tx.quantity * tx.price;
        const fees = tx.fees ?? 0;
        cashBalance += tx.type === 'buy' ? -(gross + fees) : gross - fees;
        continue;
      }

      if (event.source === 'dividend') {
        cashBalance += event.dividend.amount;
        continue;
      }

      cashBalance += event.cashEvent.type === 'deposit'
        ? event.cashEvent.amount
        : -event.cashEvent.amount;
    }

    return cashBalance;
  }

  private toTimestamp(value: unknown, fallback = 0): number {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? fallback : value.getTime();
    }

    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      const candidate = (value as { toDate?: () => unknown }).toDate?.();
      if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
        return candidate.getTime();
      }
      return fallback;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? fallback : parsed.getTime();
    }

    return fallback;
  }
}
