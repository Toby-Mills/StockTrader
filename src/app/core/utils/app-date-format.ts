import { inject } from '@angular/core';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE, MatDateFormats, NativeDateAdapter } from '@angular/material/core';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const APP_DATE_INPUT_FORMAT = { appFormat: 'dd/MMM/yyyy' };

function formatDdMmmYyyy(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS_SHORT[date.getMonth()];
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export class AppDateAdapter extends NativeDateAdapter {
  constructor() {
    super(inject(MAT_DATE_LOCALE));
  }

  override parse(value: unknown): Date | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      const match = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/.exec(trimmed);
      if (match) {
        const day = Number(match[1]);
        const monthIndex = MONTHS_SHORT.findIndex(
          month => month.toLowerCase() === match[2].toLowerCase()
        );
        const year = Number(match[3]);

        if (monthIndex >= 0) {
          const parsed = new Date(year, monthIndex, day);
          if (
            parsed.getFullYear() === year &&
            parsed.getMonth() === monthIndex &&
            parsed.getDate() === day
          ) {
            return parsed;
          }
        }
      }
    }

    return super.parse(value);
  }

  override format(date: Date, displayFormat: object): string {
    if (displayFormat === APP_DATE_INPUT_FORMAT) {
      return formatDdMmmYyyy(date);
    }
    return super.format(date, displayFormat);
  }
}

export const APP_DATE_FORMATS: MatDateFormats = {
  parse: {
    dateInput: APP_DATE_INPUT_FORMAT,
  },
  display: {
    dateInput: APP_DATE_INPUT_FORMAT,
    monthYearLabel: { month: 'short', year: 'numeric' },
    dateA11yLabel: { day: '2-digit', month: 'long', year: 'numeric' },
    monthYearA11yLabel: { month: 'long', year: 'numeric' },
  },
};

export const appDateProviders = [
  { provide: MAT_DATE_LOCALE, useValue: 'en-GB' },
  { provide: DateAdapter, useClass: AppDateAdapter },
  { provide: MAT_DATE_FORMATS, useValue: APP_DATE_FORMATS },
];
