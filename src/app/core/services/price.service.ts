import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { AuthService } from './auth.service';
import { PriceQuote, QuoteAvailability } from '../models/price-quote.model';
import { PriceProvider, ProviderQuote } from './price-provider.interface';

export interface QuoteRefreshResult {
  requestedSymbols: string[];
  updatedSymbols: string[];
  failedSymbols: string[];
}

export interface ManualQuoteInput {
  symbol: string;
  price: number;
  currency: string;
  asOf: Date;
}

class YahooFinancePriceProvider implements PriceProvider {
  readonly providerName = 'yahoo-finance';

  async fetchQuotes(symbols: string[]): Promise<ProviderQuote[]> {
    if (!symbols.length) {
      return [];
    }

    const response = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.map(symbol => encodeURIComponent(symbol)).join(',')}`
    );

    if (!response.ok) {
      throw new Error(`Price provider request failed with status ${response.status}`);
    }

    const json = (await response.json()) as {
      quoteResponse?: {
        result?: Array<{
          symbol?: string;
          regularMarketPrice?: number;
          currency?: string;
          regularMarketTime?: number;
        }>;
      };
    };

    const results = json.quoteResponse?.result ?? [];
    return results
      .filter(row => typeof row.symbol === 'string' && typeof row.regularMarketPrice === 'number')
      .map(row => ({
        symbol: (row.symbol ?? '').trim().toUpperCase(),
        price: row.regularMarketPrice ?? 0,
        currency: row.currency ?? 'UNKNOWN',
        asOf: row.regularMarketTime
          ? new Date(row.regularMarketTime * 1000)
          : new Date(),
      }));
  }
}

@Injectable({ providedIn: 'root' })
export class PriceService {
  static readonly STALE_AFTER_MS = 24 * 60 * 60 * 1000;

  private readonly firestore = inject(Firestore);
  private readonly authService = inject(AuthService);
  private readonly provider: PriceProvider = new YahooFinancePriceProvider();

  private requireAuth(): void {
    this.authService.requireUserUid();
  }

  private priceRef(accountId: string) {
    this.requireAuth();
    return collection(this.firestore, 'accounts', accountId, 'price-quotes');
  }

  getQuotes(accountId: string): Observable<PriceQuote[]> {
    const q = query(this.priceRef(accountId), orderBy('symbol', 'asc'));
    return (collectionData(q, { idField: 'id' }) as Observable<PriceQuote[]>)
      .pipe(map(quotes => quotes.map(quote => this.normalizeQuote(quote))));
  }

  getQuoteAvailability(accountId: string): Observable<Record<string, QuoteAvailability>> {
    return this.getQuotes(accountId).pipe(
      map(quotes => {
        const entries = quotes.map(quote => {
          const availability = this.toAvailability(quote);
          return [availability.symbol, availability] as const;
        });
        return Object.fromEntries(entries);
      })
    );
  }

  async refreshQuotes(accountId: string, symbols: string[]): Promise<QuoteRefreshResult> {
    const requestedSymbols = [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))];
    if (!requestedSymbols.length) {
      return {
        requestedSymbols,
        updatedSymbols: [],
        failedSymbols: [],
      };
    }

    const fetchedQuotes = await this.provider.fetchQuotes(requestedSymbols);
    const fetchedMap = new Map<string, ProviderQuote>(
      fetchedQuotes.map(quote => [quote.symbol.trim().toUpperCase(), quote])
    );

    const batch = writeBatch(this.firestore);

    for (const symbol of requestedSymbols) {
      const quote = fetchedMap.get(symbol);
      if (!quote) {
        continue;
      }

      batch.set(
        doc(this.firestore, 'accounts', accountId, 'price-quotes', symbol),
        {
          accountId,
          symbol,
          price: quote.price,
          currency: quote.currency,
          asOf: quote.asOf,
          fetchedAt: serverTimestamp(),
          provider: this.provider.providerName,
        },
        { merge: true }
      );
    }

    if (fetchedMap.size > 0) {
      await batch.commit();
    }

    const updatedSymbols = requestedSymbols.filter(symbol => fetchedMap.has(symbol));
    const failedSymbols = requestedSymbols.filter(symbol => !fetchedMap.has(symbol));

    return {
      requestedSymbols,
      updatedSymbols,
      failedSymbols,
    };
  }

  async upsertManualQuote(accountId: string, input: ManualQuoteInput): Promise<void> {
    this.requireAuth();

    const symbol = input.symbol.trim().toUpperCase();
    const currency = input.currency.trim().toUpperCase();
    if (!symbol) {
      throw new Error('Symbol is required for manual quotes');
    }

    if (!Number.isFinite(input.price)) {
      throw new Error('Manual quote price must be a valid number');
    }

    if (!currency) {
      throw new Error('Manual quote currency is required');
    }

    const asOf = this.toDate(input.asOf);
    if (!asOf) {
      throw new Error('Manual quote as-of timestamp is invalid');
    }

    await writeBatch(this.firestore)
      .set(
        doc(this.firestore, 'accounts', accountId, 'price-quotes', symbol),
        {
          accountId,
          symbol,
          price: input.price,
          currency,
          asOf,
          fetchedAt: serverTimestamp(),
          provider: 'manual',
        },
        { merge: true }
      )
      .commit();
  }

  isQuoteFresh(quote: PriceQuote, now: Date = new Date()): boolean {
    const freshnessSource = quote.fetchedAt ?? quote.asOf;
    const freshnessMs = freshnessSource.getTime();
    if (!Number.isFinite(freshnessMs)) {
      return false;
    }

    return now.getTime() - freshnessMs <= PriceService.STALE_AFTER_MS;
  }

  private normalizeQuote(quote: PriceQuote): PriceQuote {
    return {
      ...quote,
      symbol: quote.symbol.trim().toUpperCase(),
      asOf: this.toDate(quote.asOf) ?? new Date(0),
      fetchedAt: this.toDate(quote.fetchedAt),
    };
  }

  private toAvailability(quote: PriceQuote, now: Date = new Date()): QuoteAvailability {
    const isFresh = this.isQuoteFresh(quote, now);
    return {
      symbol: quote.symbol,
      quote,
      hasQuote: true,
      isFresh,
      isStale: !isFresh,
    };
  }

  private toDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value;
    }

    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      const converted = (value as { toDate?: () => unknown }).toDate?.();
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
        return converted;
      }
      return undefined;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }

    return undefined;
  }
}
