import { Component, input } from '@angular/core';

/**
 * Displays a stock/fund symbol in a styled chip with fixed-width font.
 * Input: the symbol string (e.g., 'AAPL', 'VOD.L')
 * Output: a visually distinct chip for easy identification
 */
@Component({
  selector: 'app-symbol-chip',
  standalone: true,
  imports: [],
  template: `
    <span class="symbol-chip" [attr.data-symbol]="symbol()" aria-label="Symbol chip">
      {{ symbol() }}
    </span>
  `,
  styles: [`
    :host {
      display: inline-block;
    }

    .symbol-chip {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      font-family: 'Courier New', 'Lucida Console', monospace;
      font-weight: 600;
      letter-spacing: 0.5px;
      min-height: 24px;
      padding: 0 8px;
      font-size: 13px;
      text-transform: uppercase;
      background-color: rgba(33, 150, 243, 0.08);
      color: #1976d2;
      border: 1px solid rgba(33, 150, 243, 0.2);
      line-height: 1;
    }

    .symbol-chip:hover {
      background-color: rgba(33, 150, 243, 0.12) !important;
      border-color: rgba(33, 150, 243, 0.3) !important;
    }
  `],
})
export class SymbolChipComponent {
  symbol = input.required<string>();
}

/**
 * Simpler symbol display with just fixed-width font styling (no chip overhead).
 * Used in tables, lists, and places where a light touch is needed.
 */
@Component({
  selector: 'app-symbol',
  standalone: true,
  imports: [],
  template: `
    <span class="app-symbol-chip" aria-label="Symbol">{{ symbol() }}</span>
  `,
  styles: [`
    :host {
      display: inline-block;
    }

    .app-symbol-chip {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      font-family: 'Courier New', 'Lucida Console', monospace;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      min-height: 24px;
      font-size: 13px;
      padding: 0 8px;
      background-color: rgba(33, 150, 243, 0.08);
      color: #1976d2;
      border: 1px solid rgba(33, 150, 243, 0.2);
      line-height: 1;
    }
  `],
})
export class SymbolComponent {
  symbol = input.required<string>();
}
