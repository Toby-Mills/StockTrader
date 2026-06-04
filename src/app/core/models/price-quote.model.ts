export interface PriceQuote {
  id: string;
  accountId: string;
  symbol: string;
  price: number;
  currency: string;
  asOf: Date;
  fetchedAt?: Date;
  provider: string;
}

export interface QuoteAvailability {
  symbol: string;
  quote?: PriceQuote;
  hasQuote: boolean;
  isFresh: boolean;
  isStale: boolean;
}
