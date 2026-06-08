import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, catchError, of } from 'rxjs';
import { TransactionService } from './transaction.service';
import { DividendService } from './dividend.service';
import { CashEventService } from './cash-event.service';
import { Transaction } from '../models/transaction.model';
import { Holding } from '../models/holding.model';
import { Dividend } from '../models/dividend.model';
import { FinancialCalculationsService } from './financial-calculations.service';
import { CashEvent } from '../models/cash-event.model';
import { compareByDateAndCreatedAt } from '../utils/record-sort';
import { PriceService } from './price.service';
import { PriceQuote } from '../models/price-quote.model';

export interface PerformanceCashFlow {
  date: Date;
  amount: number;
  label: string;
}

export interface SymbolPerformanceSummary {
  symbol: string;
  quantity: number;
  investedBasis: number;
  marketValue?: number;
  realizedProfitLoss: number;
  unrealizedProfitLoss?: number;
  unrealizedReturnPercent?: number;
  totalDividends: number;
  totalReturnAmount?: number;
  totalReturnPercent?: number;
  moneyWeightedReturn?: number;
  hasFreshQuote: boolean;
  quoteAsOf?: Date;
  quoteFetchedAt?: Date;
  cashFlows: PerformanceCashFlow[];
}

export interface AccountPerformanceSummary {
  investedAmount: number;
  marketValue?: number;
  cashBalance: number;
  realizedProfitLoss?: number;
  unrealizedProfitLoss?: number;
  totalDividends?: number;
  totalReturnAmount?: number;
  totalReturnPercent?: number;
  moneyWeightedReturn?: number;
  canDisplayTotals: boolean;
  missingQuoteSymbols: string[];
  lastQuoteUpdatedAt?: Date;
}

export interface PortfolioSnapshot {
  holdings: Holding[];
  cashBalance: number;
  accountPerformance: AccountPerformanceSummary;
  symbolPerformanceBySymbol: Record<string, SymbolPerformanceSummary>;
}

interface PositionState {
  qty: number;
  cost: number;
  currency: string;
  realized: number;
}

@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private transactionService = inject(TransactionService);
  private dividendService = inject(DividendService);
  private cashEventService = inject(CashEventService);
  private priceService = inject(PriceService);
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
      this.priceService.getQuotes(accountId).pipe(
        // Keep portfolio metrics available even if quote-cache access fails.
        catchError(() => of([]))
      ),
    ]).pipe(
      map(([transactions, dividends, cashEvents, quotes]) => {
        const quoteBySymbol = this.buildQuoteMap(quotes);
        const holdings = this.computeHoldings(accountId, transactions, dividends, quoteBySymbol);
        const cashBalance = this.computeCashBalance(transactions, dividends, cashEvents);
        const symbolPerformanceBySymbol = this.computeSymbolPerformance(
          transactions,
          dividends,
          quoteBySymbol
        );
        const accountPerformance = this.computeAccountPerformance(
          holdings,
          transactions,
          dividends,
          cashEvents,
          cashBalance,
          symbolPerformanceBySymbol
        );

        return {
          holdings,
          cashBalance,
          accountPerformance,
          symbolPerformanceBySymbol,
        };
      })
    );
  }

  private computeHoldings(
    accountId: string,
    transactions: Transaction[],
    dividends: Dividend[],
    quoteBySymbol: Map<string, PriceQuote>
  ): Holding[] {
    const positionBySymbol = new Map<string, PositionState>();
    const transactionsBySymbol = new Map<string, Transaction[]>();
    const dividendsBySymbol = new Map<string, Dividend[]>();
    const totalDividendsBySymbol = dividends.reduce((acc, d) => {
      const symbol = this.normalizeSymbol(d.symbol);
      acc[symbol] = (acc[symbol] ?? 0) + (d.amount - (d.fee ?? 0));
      return acc;
    }, {} as Record<string, number>);

    for (const tx of transactions) {
      const symbol = this.normalizeSymbol(tx.symbol);
      const list = transactionsBySymbol.get(symbol) ?? [];
      list.push(tx);
      transactionsBySymbol.set(symbol, list);

      const toSymbol = this.normalizeSymbol(tx.toSymbol);
      if (tx.type === 'swap' && toSymbol) {
        const toList = transactionsBySymbol.get(toSymbol) ?? [];
        toList.push(tx);
        transactionsBySymbol.set(toSymbol, toList);
      }
    }

    for (const div of dividends) {
      const symbol = this.normalizeSymbol(div.symbol);
      const list = dividendsBySymbol.get(symbol) ?? [];
      list.push(div);
      dividendsBySymbol.set(symbol, list);
    }

    const transactionsChronological = transactions
      .map((tx, originalIndex) => ({ tx, originalIndex }))
      .sort((a, b) => {
        const delta = compareByDateAndCreatedAt(a.tx, b.tx, 'asc');
        if (delta !== 0) {
          return delta;
        }

        // Fallback for legacy rows without createdAt: preserve source order.
        return a.originalIndex - b.originalIndex;
      })
      .map(entry => entry.tx);

    // Process transactions chronologically (oldest first)
    transactionsChronological.forEach(tx => {
      const symbol = this.normalizeSymbol(tx.symbol);
      const existing = positionBySymbol.get(symbol) ?? { qty: 0, cost: 0, currency: tx.currency, realized: 0 };

      if (tx.type === 'buy') {
        existing.cost += tx.quantity * tx.price + (tx.fees ?? 0);
        existing.qty  += tx.quantity;
        positionBySymbol.set(symbol, existing);
      } else if (tx.type === 'sell') {
        const avgCost = existing.qty > 0 ? existing.cost / existing.qty : 0;
        const relievedCost = avgCost * tx.quantity;
        const proceeds = tx.quantity * tx.price - (tx.fees ?? 0);
        existing.realized += proceeds - relievedCost;
        existing.cost -= avgCost * tx.quantity;
        existing.qty  -= tx.quantity;
        positionBySymbol.set(symbol, existing);
      } else if (tx.type === 'swap' && tx.toSymbol && tx.toQuantity != null) {
        // Transfer cost basis from the outgoing symbol to the incoming symbol.
        const avgCost = existing.qty > 0 ? existing.cost / existing.qty : 0;
        const transferredCost = avgCost * tx.quantity + (tx.fees ?? 0);
        existing.cost -= avgCost * tx.quantity;
        existing.qty  -= tx.quantity;
        positionBySymbol.set(symbol, existing);

        const toSymbol = this.normalizeSymbol(tx.toSymbol);
        const toExisting = positionBySymbol.get(toSymbol) ?? { qty: 0, cost: 0, currency: tx.currency, realized: 0 };
        toExisting.cost += transferredCost;
        toExisting.qty  += tx.toQuantity;
        positionBySymbol.set(toSymbol, toExisting);
      }
    });

    return Array.from(positionBySymbol.entries()).map(([symbol, state]) => {
      const symbolTransactions = transactionsBySymbol.get(symbol) ?? [];
      const grossBuyAmount = symbolTransactions
        .filter(tx => tx.type === 'buy' && this.normalizeSymbol(tx.symbol) === symbol)
        .reduce((sum, tx) => sum + tx.quantity * tx.price + (tx.fees ?? 0), 0);
      const grossSellAmount = symbolTransactions
        .filter(tx => tx.type === 'sell' && this.normalizeSymbol(tx.symbol) === symbol)
        .reduce((sum, tx) => sum + tx.quantity * tx.price - (tx.fees ?? 0), 0);

      const quote = quoteBySymbol.get(symbol);
      const hasFreshQuote = !!quote && this.priceService.isQuoteFresh(quote);
      const currentPrice = hasFreshQuote ? quote?.price : undefined;
      const currentValue = hasFreshQuote && currentPrice != null ? state.qty * currentPrice : undefined;
      const unrealizedGainLoss = currentValue != null ? currentValue - state.cost : undefined;
      const unrealizedGainLossPercent =
        unrealizedGainLoss != null && state.cost > 0 ? unrealizedGainLoss / state.cost : undefined;

      const terminalValueForGrowth = currentValue ?? (state.qty <= 0 ? 0 : 0);

      return {
        symbol,
        accountId,
        quantity: state.qty,
        averageCost: state.qty > 0 ? state.cost / state.qty : 0,
        totalCost: state.cost,
        currency: state.currency,
        grossBuyAmount,
        grossSellAmount,
        netInvestedAmount: grossBuyAmount - grossSellAmount,
        realizedGainLoss: state.realized,
        totalDividends: totalDividendsBySymbol[symbol] ?? 0,
        currentPrice,
        currentValue,
        quoteAsOf: quote?.asOf,
        quoteFetchedAt: quote?.fetchedAt,
        quoteIsFresh: hasFreshQuote,
        quoteIsMissing: state.qty > 0 && !hasFreshQuote,
        unrealizedGainLoss,
        unrealizedGainLossPercent,
        gainLoss: unrealizedGainLoss,
        gainLossPercent: unrealizedGainLossPercent,
        effectiveAnnualGrowthRate: this.financialCalculations.calculateEffectiveAnnualGrowthRate(
          symbolTransactions,
          dividendsBySymbol.get(symbol) ?? [],
          terminalValueForGrowth
        ),
      };
    });
  }

  private computeSymbolPerformance(
    transactions: Transaction[],
    dividends: Dividend[],
    quoteBySymbol: Map<string, PriceQuote>
  ): Record<string, SymbolPerformanceSummary> {
    const symbols = new Set<string>();
    for (const tx of transactions) {
      symbols.add(this.normalizeSymbol(tx.symbol));
      if (tx.type === 'swap' && tx.toSymbol) {
        symbols.add(this.normalizeSymbol(tx.toSymbol));
      }
    }
    for (const div of dividends) {
      symbols.add(this.normalizeSymbol(div.symbol));
    }

    const transactionsChronological = transactions
      .map((tx, originalIndex) => ({ tx, originalIndex }))
      .sort((a, b) => {
        const delta = compareByDateAndCreatedAt(a.tx, b.tx, 'asc');
        if (delta !== 0) {
          return delta;
        }
        return a.originalIndex - b.originalIndex;
      })
      .map(entry => entry.tx);

    const result: Record<string, SymbolPerformanceSummary> = {};

    for (const symbol of symbols) {
      let quantity = 0;
      let investedBasis = 0;
      let realizedProfitLoss = 0;
      let totalDividends = 0;
      const cashFlows: PerformanceCashFlow[] = [];

      for (const tx of transactionsChronological) {
        const date = this.financialCalculations.toDate(tx.date);
        if (!date) {
          continue;
        }

        const fromSymbol = this.normalizeSymbol(tx.symbol);
        const toSymbol = this.normalizeSymbol(tx.toSymbol);
        const fees = tx.fees ?? 0;

        if (tx.type === 'buy' && fromSymbol === symbol) {
          const outflow = tx.quantity * tx.price + fees;
          quantity += tx.quantity;
          investedBasis += outflow;
          cashFlows.push({ date, amount: -outflow, label: `Buy ${symbol}` });
          continue;
        }

        if (tx.type === 'sell' && fromSymbol === symbol) {
          const averageCost = quantity > 0 ? investedBasis / quantity : 0;
          const relievedCost = averageCost * tx.quantity;
          const proceeds = tx.quantity * tx.price - fees;
          quantity -= tx.quantity;
          investedBasis -= relievedCost;
          realizedProfitLoss += proceeds - relievedCost;
          cashFlows.push({ date, amount: proceeds, label: `Sell ${symbol}` });
          continue;
        }

        if (tx.type === 'swap' && fromSymbol === symbol) {
          const averageCost = quantity > 0 ? investedBasis / quantity : 0;
          const relievedCost = averageCost * tx.quantity;
          quantity -= tx.quantity;
          investedBasis -= relievedCost;
          if (fees > 0) {
            cashFlows.push({ date, amount: -fees, label: `Swap fee ${symbol}` });
          }
          continue;
        }

        if (tx.type === 'swap' && toSymbol === symbol) {
          quantity += tx.toQuantity ?? 0;
        }
      }

      for (const div of dividends) {
        if (this.normalizeSymbol(div.symbol) !== symbol) {
          continue;
        }

        const date = this.financialCalculations.toDate(div.date);
        if (!date) {
          continue;
        }

        const netDividend = div.amount - (div.fee ?? 0);
        totalDividends += netDividend;
        cashFlows.push({ date, amount: netDividend, label: `Dividend ${symbol}` });
      }

      const quote = quoteBySymbol.get(symbol);
      const hasFreshQuote = !!quote && this.priceService.isQuoteFresh(quote);
      const canValuePosition = quantity <= 0 || hasFreshQuote;
      const marketValue = canValuePosition
        ? quantity <= 0
          ? 0
          : (quote?.price ?? 0) * quantity
        : undefined;
      const unrealizedProfitLoss = marketValue != null ? marketValue - investedBasis : undefined;
      const unrealizedReturnPercent =
        unrealizedProfitLoss != null && investedBasis > 0
          ? unrealizedProfitLoss / investedBasis
          : undefined;
      const totalReturnAmount =
        unrealizedProfitLoss != null
          ? realizedProfitLoss + unrealizedProfitLoss + totalDividends
          : undefined;
      const totalReturnPercent =
        totalReturnAmount != null && investedBasis > 0
          ? totalReturnAmount / investedBasis
          : undefined;

      const moneyWeightedReturn =
        marketValue != null
          ? this.financialCalculations.calculateMoneyWeightedReturn(
              cashFlows.map(cashFlow => ({ date: cashFlow.date, amount: cashFlow.amount })),
              marketValue
            )
          : undefined;

      cashFlows.sort((a, b) => a.date.getTime() - b.date.getTime());

      result[symbol] = {
        symbol,
        quantity,
        investedBasis,
        marketValue,
        realizedProfitLoss,
        unrealizedProfitLoss,
        unrealizedReturnPercent,
        totalDividends,
        totalReturnAmount,
        totalReturnPercent,
        moneyWeightedReturn,
        hasFreshQuote,
        quoteAsOf: quote?.asOf,
        quoteFetchedAt: quote?.fetchedAt,
        cashFlows,
      };
    }

    return result;
  }

  private computeAccountPerformance(
    holdings: Holding[],
    transactions: Transaction[],
    dividends: Dividend[],
    cashEvents: CashEvent[],
    cashBalance: number,
    symbolPerformanceBySymbol: Record<string, SymbolPerformanceSummary>
  ): AccountPerformanceSummary {
    const openHoldings = holdings.filter(holding => holding.quantity > 0);
    const missingQuoteSymbols = openHoldings
      .filter(holding => !holding.quoteIsFresh)
      .map(holding => holding.symbol)
      .sort((a, b) => a.localeCompare(b));

    const canDisplayTotals = missingQuoteSymbols.length === 0;
    const investedAmount = this.computeNetContributions(cashEvents);

    if (!canDisplayTotals) {
      return {
        investedAmount,
        cashBalance,
        canDisplayTotals,
        missingQuoteSymbols,
      };
    }

    const marketValue = openHoldings.reduce((sum, holding) => sum + (holding.currentValue ?? 0), 0);
    const realizedProfitLoss = Object.values(symbolPerformanceBySymbol)
      .reduce((sum, summary) => sum + summary.realizedProfitLoss, 0);
    const unrealizedProfitLoss = openHoldings
      .reduce((sum, holding) => sum + (holding.unrealizedGainLoss ?? 0), 0);
    const totalDividends = dividends.reduce((sum, div) => sum + div.amount - (div.fee ?? 0), 0);
    const totalReturnAmount = realizedProfitLoss + unrealizedProfitLoss + totalDividends;
    const totalReturnPercent =
      investedAmount !== 0 ? totalReturnAmount / investedAmount : undefined;
    const lastQuoteUpdatedAt = openHoldings.reduce<Date | undefined>((latest, holding) => {
      const candidate = holding.quoteFetchedAt ?? holding.quoteAsOf;
      if (!candidate) {
        return latest;
      }
      if (!latest || candidate.getTime() > latest.getTime()) {
        return candidate;
      }
      return latest;
    }, undefined);

    const accountCashFlows = this.buildAccountCashFlows(transactions, dividends, cashEvents);
    const moneyWeightedReturn = this.financialCalculations.calculateMoneyWeightedReturn(
      accountCashFlows,
      marketValue
    );

    return {
      investedAmount,
      marketValue,
      cashBalance,
      realizedProfitLoss,
      unrealizedProfitLoss,
      totalDividends,
      totalReturnAmount,
      totalReturnPercent,
      moneyWeightedReturn,
      canDisplayTotals,
      missingQuoteSymbols,
      lastQuoteUpdatedAt,
    };
  }

  private computeNetContributions(cashEvents: CashEvent[]): number {
    return cashEvents.reduce((sum, event) => {
      const fee = event.fee ?? 0;
      if (event.type === 'deposit' || event.type === 'interest') {
        return sum + event.amount - fee;
      }

      return sum - (event.amount + fee);
    }, 0);
  }

  /** Compute total invested amount (Deposits - Withdrawals) as of a specific date. */
  computeInvestedAmount(
    cashEvents: CashEvent[],
    asOfDate?: Date
  ): number {
    return cashEvents
      .filter(event => {
        if (!asOfDate) {
          return true;
        }
        const date = this.financialCalculations.toDate(event.date);
        return date ? date.getTime() <= asOfDate.getTime() : false;
      })
      .reduce((sum, event) => {
        if (event.type === 'deposit') {
          return sum + event.amount;
        }
        if (event.type === 'withdrawal') {
          return sum - event.amount;
        }
        return sum;
      }, 0);
  }

  private buildAccountCashFlows(
    transactions: Transaction[],
    dividends: Dividend[],
    cashEvents: CashEvent[]
  ): Array<{ date: Date; amount: number }> {
    const cashFlows: Array<{ date: Date; amount: number }> = [];

    for (const tx of transactions) {
      const date = this.financialCalculations.toDate(tx.date);
      if (!date) {
        continue;
      }

      if (tx.type === 'buy') {
        cashFlows.push({
          date,
          amount: -(tx.quantity * tx.price + (tx.fees ?? 0)),
        });
        continue;
      }

      if (tx.type === 'sell') {
        cashFlows.push({
          date,
          amount: tx.quantity * tx.price - (tx.fees ?? 0),
        });
        continue;
      }

      const fees = tx.fees ?? 0;
      if (fees > 0) {
        cashFlows.push({ date, amount: -fees });
      }
    }

    for (const div of dividends) {
      const date = this.financialCalculations.toDate(div.date);
      if (!date) {
        continue;
      }

      cashFlows.push({ date, amount: div.amount - (div.fee ?? 0) });
    }

    for (const event of cashEvents) {
      const date = this.financialCalculations.toDate(event.date);
      if (!date) {
        continue;
      }

      const fee = event.fee ?? 0;
      if (event.type === 'deposit' || event.type === 'interest') {
        cashFlows.push({ date, amount: event.amount - fee });
        continue;
      }

      cashFlows.push({ date, amount: -(event.amount + fee) });
    }

    return cashFlows;
  }

  private buildQuoteMap(quotes: PriceQuote[]): Map<string, PriceQuote> {
    const mapBySymbol = new Map<string, PriceQuote>();
    for (const quote of quotes) {
      mapBySymbol.set(this.normalizeSymbol(quote.symbol), quote);
    }
    return mapBySymbol;
  }

  private normalizeSymbol(symbol: string | undefined | null): string {
    return (symbol ?? '').trim().toUpperCase();
  }

  /** Compute the cash balance as of a specific date. */
  computeCashBalance(
    transactions: Transaction[],
    dividends: Dividend[],
    cashEvents: CashEvent[],
    asOfDate?: Date
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
        createdAt: dividend.createdAt,
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
      const delta = compareByDateAndCreatedAt(a, b, 'asc');
      if (delta !== 0) {
        return delta;
      }

      return a.originalIndex - b.originalIndex;
    });

    let cashBalance = 0;
    for (const event of events) {
      if (asOfDate) {
        const eventDate = this.financialCalculations.toDate(event.date);
        if (eventDate && eventDate > asOfDate) {
          continue;
        }
      }

      if (event.source === 'transaction') {
        const tx = event.transaction;
        if (tx.type === 'swap') {
          // Swaps have no cash impact beyond any fees paid.
          cashBalance -= tx.fees ?? 0;
        } else {
          const gross = tx.quantity * tx.price;
          const fees = tx.fees ?? 0;
          cashBalance += tx.type === 'buy' ? -(gross + fees) : gross - fees;
        }
        continue;
      }

      if (event.source === 'dividend') {
        cashBalance += event.dividend.amount - (event.dividend.fee ?? 0);
        continue;
      }

      const fee = event.cashEvent.fee ?? 0;
      if (event.cashEvent.type === 'deposit' || event.cashEvent.type === 'interest') {
        cashBalance += event.cashEvent.amount - fee;
        continue;
      }

      cashBalance -= event.cashEvent.amount + fee; // handles 'withdrawal' and 'fee'
    }

    return cashBalance;
  }
}
