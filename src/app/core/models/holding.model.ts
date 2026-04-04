/** Computed (not stored) — derived from transactions for a given symbol in an account. */
export interface Holding {
  symbol: string;
  accountId: string;
  quantity: number;
  averageCost: number;
  totalCost: number;
  currency: string;
  grossBuyAmount?: number;
  grossSellAmount?: number;
  netInvestedAmount?: number;
  // Annualized money-weighted growth rate (decimal), derived from dated cash flows.
  effectiveAnnualGrowthRate?: number;
  // Populated when live prices are available
  currentPrice?: number;
  currentValue?: number;
  gainLoss?: number;
  gainLossPercent?: number;
  totalDividends?: number;
}
