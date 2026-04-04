import { Injectable } from '@angular/core';
import { Dividend } from '../models/dividend.model';
import { Transaction } from '../models/transaction.model';

type CashFlow = {
  date: Date;
  amount: number;
};

@Injectable({ providedIn: 'root' })
export class FinancialCalculationsService {
  calculateEffectiveAnnualGrowthRate(
    transactions: Transaction[],
    dividends: Dividend[],
    terminalValue: number
  ): number | undefined {
    const now = new Date();
    const cashFlows: CashFlow[] = [];

    for (const tx of transactions) {
      const date = this.normalizeDate(tx.date);
      if (!date) continue;

      if (tx.type === 'buy') {
        cashFlows.push({
          date,
          amount: -(tx.quantity * tx.price + (tx.fees ?? 0)),
        });
      } else {
        cashFlows.push({
          date,
          amount: tx.quantity * tx.price - (tx.fees ?? 0),
        });
      }
    }

    for (const div of dividends) {
      const date = this.normalizeDate(div.date);
      if (!date) continue;
      cashFlows.push({ date, amount: div.amount });
    }

    if (terminalValue > 0) {
      cashFlows.push({ date: now, amount: terminalValue });
    }

    return this.xirr(cashFlows);
  }

  private normalizeDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value;
    }

    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      const candidate = (value as { toDate?: () => unknown }).toDate?.();
      if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
        return candidate;
      }
      return undefined;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }

    return undefined;
  }

  private xirr(cashFlows: CashFlow[]): number | undefined {
    if (cashFlows.length < 2) {
      return undefined;
    }

    const sorted = [...cashFlows].sort((a, b) => a.date.getTime() - b.date.getTime());
    const firstDate = sorted[0].date;
    const hasPositive = sorted.some(flow => flow.amount > 0);
    const hasNegative = sorted.some(flow => flow.amount < 0);

    if (!hasPositive || !hasNegative) {
      return undefined;
    }

    const npv = (rate: number): number => {
      if (rate <= -0.999999) {
        return Number.NaN;
      }

      return sorted.reduce((sum, flow) => {
        const days = (flow.date.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
        const yearFrac = days / 365.25;
        return sum + flow.amount / Math.pow(1 + rate, yearFrac);
      }, 0);
    };

    const dNpv = (rate: number): number => {
      if (rate <= -0.999999) {
        return Number.NaN;
      }

      return sorted.reduce((sum, flow) => {
        const days = (flow.date.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
        const yearFrac = days / 365.25;
        if (yearFrac === 0) {
          return sum;
        }
        return sum - (yearFrac * flow.amount) / Math.pow(1 + rate, yearFrac + 1);
      }, 0);
    };

    // Newton-Raphson converges quickly for most realistic holding cash flows.
    let rate = 0.1;
    for (let i = 0; i < 50; i++) {
      const value = npv(rate);
      const deriv = dNpv(rate);
      if (!Number.isFinite(value) || !Number.isFinite(deriv) || Math.abs(deriv) < 1e-12) {
        break;
      }

      const next = rate - value / deriv;
      if (!Number.isFinite(next)) {
        break;
      }

      if (Math.abs(next - rate) < 1e-10) {
        return next;
      }
      rate = next;
    }

    // Fallback bisection in case Newton does not converge.
    let low = -0.999;
    let high = 10;
    let lowNpv = npv(low);
    let highNpv = npv(high);

    let expandTries = 0;
    while (Number.isFinite(lowNpv) && Number.isFinite(highNpv) && lowNpv * highNpv > 0 && expandTries < 20) {
      high *= 2;
      highNpv = npv(high);
      expandTries += 1;
    }

    if (!Number.isFinite(lowNpv) || !Number.isFinite(highNpv) || lowNpv * highNpv > 0) {
      return undefined;
    }

    for (let i = 0; i < 100; i++) {
      const mid = (low + high) / 2;
      const midNpv = npv(mid);

      if (!Number.isFinite(midNpv)) {
        return undefined;
      }

      if (Math.abs(midNpv) < 1e-8 || Math.abs(high - low) < 1e-10) {
        return mid;
      }

      if (lowNpv * midNpv < 0) {
        high = mid;
        highNpv = midNpv;
      } else {
        low = mid;
        lowNpv = midNpv;
      }
    }

    return undefined;
  }
}
