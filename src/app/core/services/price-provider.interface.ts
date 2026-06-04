export interface ProviderQuote {
  symbol: string;
  price: number;
  currency: string;
  asOf: Date;
}

export interface PriceProvider {
  readonly providerName: string;
  fetchQuotes(symbols: string[]): Promise<ProviderQuote[]>;
}
