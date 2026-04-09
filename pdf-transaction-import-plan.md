# PDF Transaction Import Plan

## Goal
Allow a user to upload a PDF statement and extract exactly one transaction to prefill the existing Add Transaction dialog, then let the user review and save manually.

## Success Criteria
- User clicks the existing Add Transaction button to open the current transaction dialog.
- Dialog contains an Import from PDF action.
- App extracts transaction details from the PDF in the browser.
- App maps extracted values to the existing transaction form fields.
- Parsed values pre-populate the dialog form (no automatic write to Firestore).
- User can edit any prefilled field before save.
- User saves using the existing Save/Create flow in the same dialog.
- No backend required; feature works with current Angular + Firebase architecture.

## Assumptions
- PDFs are mostly text-based broker statements (not scanned images).
- Each imported PDF file contains exactly one transaction.
- Import is account-scoped; user selects target account first.
- Imported transactions use the parent account currency (existing project convention).
- Date, type, symbol, quantity, and unit price (or total value) are typically present in statement lines.

## High-Level Design
1. Keep current Add Transaction entry point unchanged.
2. Add an Import from PDF button inside the existing transaction dialog.
3. A client-side PDF parser extracts raw text from uploaded file.
4. A transaction import service converts extracted text into a single parsed transaction.
5. Parsed transaction is mapped to the existing transaction form model and applied with `patchValue`.
6. User reviews/edits form and saves via existing `TransactionService` flow.

## Proposed Files and Components
- Reuse existing: `src/app/features/transactions/transaction-dialog.component.ts`
- Reuse existing: `src/app/features/transactions/transaction-dialog.component.html`
- Reuse existing: `src/app/features/transactions/transaction-dialog.component.scss`
- New: `src/app/core/services/transaction-pdf-import.service.ts`
- New: `src/app/core/models/transaction-import.model.ts`
- Optional update: `src/app/features/transactions/transactions.component.ts` (only if dialog open payload needs extension)

## Data Contracts
### Import Candidate
- `sourceLine: string`
- `parsedDate?: Date`
- `type?: 'buy' | 'sell'`
- `symbol?: string`
- `quantity?: number`
- `pricePerShare?: number`
- `fees?: number`
- `notes?: string`
- `confidence: number` (0 to 1)
- `errors: string[]`

### Import Result
- `parsedTransaction?: ImportCandidate`
- `warnings: string[]`

### Form Prefill Payload
- `transactionDate?: string | Date`
- `type?: 'buy' | 'sell'`
- `symbol?: string`
- `quantity?: number`
- `price?: number`
- `fees?: number`
- `notes?: string`

## Library Choice
Use `pdfjs-dist` for in-browser text extraction.
- Install: `npm install pdfjs-dist`
- Keep parsing client-side to match current no-backend architecture.

## Parsing Strategy (MVP)
1. Extract text per PDF page.
2. Normalize whitespace and split into lines.
3. Identify the line(s) representing the single transaction using regex patterns.
4. Parse fields with prioritized patterns:
   - Date formats: `DD/MM/YYYY`, `YYYY-MM-DD`, `DD Mon YYYY`
   - Type keywords: `BUY`, `SELL`
   - Symbol format: uppercase ticker token
   - Quantity/price/amount numeric parsing with commas
5. Parse one transaction with confidence scoring.
6. Map parsed transaction to transaction dialog form fields.

## Validation Rules
- Required for prefill: at least two of date/type/symbol/quantity and one price-like field.
- Required for final save remains the existing transaction form validation rules.
- Quantity must be greater than zero.
- Price and fees must be non-negative.
- Symbol normalized to uppercase and trimmed.
- Currency mismatch is shown as warning; user must resolve before save if form validation enforces currency constraints.

## UX Flow
1. User opens Transactions page and clicks Add Transaction (existing behavior).
2. Existing transaction dialog opens.
3. User clicks Import from PDF in that dialog.
4. User selects a PDF; app parses one transaction from the file.
5. Dialog form fields are prefilled with parsed values.
6. User reviews/edits prefilled fields.
7. User clicks Save (existing action), creating a single transaction record.

## Error Handling
- File type guard: reject non-PDF files.
- Size guard: warn for large files (for example > 10 MB).
- Parser guard: show actionable error if no parseable transaction found.
- Single-transaction guard: if parser detects more than one transaction-like line, show an error and do not prefill.
- Do not auto-save anything on parse success.
- Duplicate detection (phase 2): warn if form values match an existing transaction fingerprint.

## Security and Privacy
- Parse file entirely in browser; do not upload PDF contents to external services.
- Avoid logging raw statement text in production.
- Keep only minimal derived transaction fields.

## Implementation Plan
### Phase 1: Foundation
- Add import models for parsed transaction and result.
- Add `pdfjs-dist` dependency and wrapper logic for extraction.
- Build `TransactionPdfImportService` with parse + validate pipeline.

### Phase 2: UI Integration
- Add Import from PDF button to existing `TransactionDialogComponent`.
- Add hidden file input and parse trigger in dialog.
- On parse success, `patchValue` into existing form controls and mark imported fields for user visibility.
- Keep save behavior unchanged: user must click Save manually.

### Phase 3: Quality and Hardening
- Add parse confidence indicator and diagnostics in dialog.
- Improve parser strictness so one-transaction files are consistently recognized.
- Add duplicate warning heuristic (date + type + symbol + quantity + amount).

## Testing Plan
### Unit Tests
- Parser tests with representative statement text fixtures.
- Validation tests for required/malformed fields.
- Normalization tests for symbols and numeric formats.
- Guard tests that reject PDFs containing multiple transaction-like rows.

### Component Tests
- Transaction dialog shows Import from PDF button.
- Parse success patches expected form fields.
- Parse failure shows error message without mutating existing user-entered values.
- Save remains user-driven and creates exactly one transaction.

### Integration Tests
- Add Transaction opens dialog with import action available.
- Import + save path creates one transaction and refreshes list.

## Rollout Plan
1. Ship MVP for one statement format first.
2. Gather real sample PDFs and expand parser patterns incrementally.
3. Add broker-specific parser modules if needed.

## Open Questions
- Which broker statement format should be first-class for MVP?
- Should fees be included in transaction model fields or appended to notes when missing model support?
- Should duplicate detection block save or only warn?

## Future Enhancements
- Broker-specific parser plugins.
- OCR fallback for scanned statements (optional external service).
- Template learning from corrected rows.
- Export parse report for audit trail.
