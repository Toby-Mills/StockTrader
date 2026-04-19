import { Pipe, PipeTransform } from '@angular/core';

/**
 * Pipe to display symbol + fullName in a consistent format.
 * Input: symbol code (e.g., 'AAPL')
 * Output: formatted string for display in dropdowns/tables
 */
@Pipe({
  name: 'symbolDisplay',
  standalone: true,
})
export class SymbolDisplayPipe implements PipeTransform {
  transform(symbol: string, fullName?: string): string {
    if (!symbol) return '';
    if (!fullName) return symbol.toUpperCase();
    return `${symbol.toUpperCase()} • ${fullName}`;
  }
}
