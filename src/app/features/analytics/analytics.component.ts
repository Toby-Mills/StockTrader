import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { Account } from '../../core/models/account.model';
import { TrackedSymbol } from '../../core/models/tracked-symbol.model';
import { AccountService } from '../../core/services/account.service';
import { PortfolioService, PortfolioSnapshot, SymbolPerformanceSummary } from '../../core/services/portfolio.service';
import { PriceService } from '../../core/services/price.service';
import { SymbolCatalogService } from '../../core/services/symbol-catalog.service';
import { SymbolComponent } from '../../shared/symbol-chip.component';

@Component({
    standalone: true,
    selector: 'app-analytics',
        imports: [
            CommonModule,
            MatCardModule,
            MatFormFieldModule,
            MatSelectModule,
            MatButtonModule,
            MatIconModule,
            SymbolComponent,
        ],
    templateUrl: './analytics.component.html',
    styleUrl: './analytics.component.scss'
})
export class AnalyticsComponent {
    private readonly accountService = inject(AccountService);
    private readonly portfolioService = inject(PortfolioService);
    private readonly symbolCatalogService = inject(SymbolCatalogService);
    private readonly priceService = inject(PriceService);

    private readonly accountsSignal = toSignal(this.accountService.getAccounts(), {
        initialValue: [] as Account[],
    });

    readonly accounts = computed(() =>
        [...this.accountsSignal()].sort((a, b) => a.name.localeCompare(b.name))
    );

    readonly selectedAccountId = signal('');
    readonly selectedSymbol = signal('ALL');
    readonly portfolioSnapshot = signal<PortfolioSnapshot | null>(null);
    readonly trackedSymbols = signal<TrackedSymbol[]>([]);
    readonly isRefreshingQuotes = signal(false);
    readonly feedbackMessage = signal('');

    readonly hasAccounts = computed(() => this.accounts().length > 0);

    readonly selectedAccount = computed(() =>
        this.accounts().find(account => account.id === this.selectedAccountId()) ?? null
    );

    readonly holdingsValuation = computed(() =>
        (this.portfolioSnapshot()?.holdings ?? [])
            .filter(holding => holding.quantity > 0)
            .sort((a, b) => a.symbol.localeCompare(b.symbol))
    );

    readonly accountPerformance = computed(() => this.portfolioSnapshot()?.accountPerformance ?? null);

    readonly selectedSymbolPerformance = computed<SymbolPerformanceSummary | null>(() => {
        const symbol = this.selectedSymbol();
        if (symbol === 'ALL') {
            return null;
        }

        return this.portfolioSnapshot()?.symbolPerformanceBySymbol[symbol] ?? null;
    });

    readonly symbolNameByCode = computed(() => {
        const lookup = new Map<string, string>();
        for (const symbol of this.trackedSymbols()) {
            lookup.set(symbol.symbol.trim().toUpperCase(), symbol.fullName);
        }
        return lookup;
    });

    readonly symbols = computed(() => {
        const fromTracked = this.trackedSymbols().map(symbol => symbol.symbol.toUpperCase());
        const fromPerformance = Object.keys(this.portfolioSnapshot()?.symbolPerformanceBySymbol ?? {});
        const fromHoldings = this.holdingsValuation().map(holding => holding.symbol.toUpperCase());

        return [...new Set([...fromTracked, ...fromPerformance, ...fromHoldings])].sort((a, b) =>
            a.localeCompare(b)
        );
    });

    constructor() {
        effect(() => {
            const accountList = this.accounts();
            const selected = this.selectedAccountId();
            if (!accountList.length) {
                this.selectedAccountId.set('');
                return;
            }

            if (!selected || !accountList.some(account => account.id === selected)) {
                this.selectedAccountId.set(accountList[0].id);
            }
        }, { allowSignalWrites: true });

        effect(onCleanup => {
            const accountId = this.selectedAccountId();
            if (!accountId) {
                this.portfolioSnapshot.set(null);
                return;
            }

            const subscription = this.portfolioService.getPortfolioSnapshot(accountId).subscribe({
                next: snapshot => {
                    this.portfolioSnapshot.set(snapshot);
                },
                error: error => {
                    this.feedbackMessage.set(this.errorMessage(error, 'Could not compute account performance metrics'));
                },
            });

            onCleanup(() => subscription.unsubscribe());
        }, { allowSignalWrites: true });

        effect(onCleanup => {
            const accountId = this.selectedAccountId();
            if (!accountId) {
                this.trackedSymbols.set([]);
                return;
            }

            const subscription = this.symbolCatalogService.getSymbols(accountId).subscribe({
                next: symbols => {
                    this.trackedSymbols.set([...symbols].sort((a, b) => a.symbol.localeCompare(b.symbol)));
                },
                error: error => {
                    this.feedbackMessage.set(this.errorMessage(error, 'Could not load symbols'));
                },
            });

            onCleanup(() => subscription.unsubscribe());
        }, { allowSignalWrites: true });

        effect(() => {
            const selected = this.selectedSymbol();
            if (selected === 'ALL') {
                return;
            }

            if (!this.symbols().includes(selected)) {
                this.selectedSymbol.set('ALL');
            }
        }, { allowSignalWrites: true });
    }

    onAccountChanged(accountId: string): void {
        this.selectedAccountId.set(accountId);
        this.selectedSymbol.set('ALL');
        this.feedbackMessage.set('');
    }

    onSymbolChanged(symbol: string): void {
        this.selectedSymbol.set(symbol);
    }

    async refreshHeldSymbolQuotes(): Promise<void> {
        const account = this.selectedAccount();
        if (!account || this.isRefreshingQuotes()) {
            return;
        }

        const heldSymbols = this.holdingsValuation()
            .filter(holding => holding.quantity > 0)
            .map(holding => holding.symbol);

        this.isRefreshingQuotes.set(true);
        this.feedbackMessage.set('');

        try {
            const result = await this.priceService.refreshQuotes(account.id, heldSymbols);
            const total = result.requestedSymbols.length;
            const updated = result.updatedSymbols.length;
            const failed = result.failedSymbols.length;
            this.feedbackMessage.set(
                `Quotes refreshed: ${updated}/${total}${failed > 0 ? ` (${failed} missing)` : ''}.`
            );
        } catch (error) {
            this.feedbackMessage.set(this.errorMessage(error, 'Could not refresh quotes'));
        } finally {
            this.isRefreshingQuotes.set(false);
        }
    }

    formatDate(rawDate: unknown): string {
        const date = this.toDate(rawDate);
        if (!date) {
            return 'Unknown';
        }

        return new Intl.DateTimeFormat('en-GB', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
        }).format(date);
    }

    formatMoney(amount: number, currency: string): string {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    }

    formatPercent(value: number | undefined): string {
        if (value == null) {
            return 'Unavailable';
        }

        return new Intl.NumberFormat('en-GB', {
            style: 'percent',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }

    formatQuoteTimestamp(value: Date | undefined): string {
        if (!value) {
            return 'Unknown';
        }

        return new Intl.DateTimeFormat('en-GB', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        }).format(value);
    }

    private toDate(value: unknown): Date | null {
        if (!value) {
            return null;
        }

        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }

        if (typeof value === 'string' || typeof value === 'number') {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }

        if (typeof value === 'object') {
            const maybeTimestamp = value as { toDate?: () => Date };
            if (typeof maybeTimestamp.toDate === 'function') {
                const converted = maybeTimestamp.toDate();
                return Number.isNaN(converted.getTime()) ? null : converted;
            }
        }

        return null;
    }

    private errorMessage(error: unknown, fallback: string): string {
        if (typeof error === 'string') {
            return error;
        }

        if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
            return (error as { message: string }).message;
        }

        return fallback;
    }
}
