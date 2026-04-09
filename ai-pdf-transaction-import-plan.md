# AI PDF Transaction Parsing Plan

## Goal
Replace the current deterministic PDF transaction parsing approach with AI-assisted parsing using Firebase AI Logic via the `firebase/ai` integration.

The user should still import a PDF from the existing Add Transaction dialog, review the extracted fields, and save manually. The difference is that the app will send the PDF directly to Gemini through Firebase AI Logic and let the model handle both document understanding and transaction extraction.

## Non-Goals
- Do not auto-save imported transactions.
- Do not add OCR outside Gemini's native document understanding path in the first version.
- Remove the existing text extration and deterministic parser.

## Success Criteria
- User clicks Add Transaction and opens the existing transaction dialog.
- Dialog contains an Import from PDF action.
- App sends the selected PDF to Gemini using Firebase AI Logic.
- Gemini returns exactly one parsed transaction in strict JSON.
- Dialog pre-fills the existing form with returned values.
- User can review and edit all fields before saving.
- Save continues to use the current transaction creation flow.
- API access is mediated through Firebase AI Logic, with App Check enabled before production rollout.

## Current Repo Impact
- The repo already has Firebase configured and already depends on the top-level `firebase` package.
- The implementation should use the app-facing `firebase/ai` entrypoint from the existing `firebase` dependency.
- The existing PDF import service and dialog integration can be reused, but the text extraction and deterministic parsing internals should be removed.

## Proposed File and Project Changes

### Frontend
- Reuse: `src/app/features/transactions/transaction-dialog.component.ts`
- Reuse: `src/app/features/transactions/transaction-dialog.component.html`
- Reuse: `src/app/features/transactions/transaction-dialog.component.scss`
- Update: `src/app/core/services/transaction-pdf-import.service.ts`
- Update: `src/app/core/models/transaction-import.model.ts`
- Update: `src/app/app.config.ts` if Firebase AI Logic initialization or App Check wiring is added there

### Firebase and Project Config
- Update: `package.json` only if the installed `firebase` version must be raised to a version with the required AI Logic surface
- Optional: App Check configuration in the existing Firebase setup

## Data Flow

### Client Request to Firebase AI Logic
- `accountCurrency: string`
- `pdfFile: File`

### AI Response
- `parsedTransaction?: { ... }`
- `warnings: string[]`
- `confidence: number`
- `diagnostics?: string[]`

### Parsed Transaction Shape
- `transactionDate?: string`
- `type?: 'buy' | 'sell'`
- `symbol?: string`
- `quantity?: number`
- `price?: number`
- `fees?: number`
- `notes?: string`

Dates should be returned in ISO format such as `YYYY-MM-DD`.

## Frontend Responsibilities

### Keep in Browser
- File selection
- Basic PDF file validation
- Direct invocation of Firebase AI Logic via `firebase/ai`
- Validation and normalization of AI response
- Manual review in the transaction dialog
- Existing transaction save flow

### Send to Firebase AI Logic
- PDF file itself, not extracted text
- Account currency as supporting context for normalization
- Required JSON schema for the structured transaction response

### Frontend Validation
- Ensure a file is selected
- Reject non-PDF files
- Warn on large files
- Show clear import status
- Patch only known form fields
- Preserve manual save behavior

## Firebase AI Logic Responsibilities

### Invocation Model
- Use Firebase AI Logic from the Angular app via the `firebase/ai` entrypoint from the `firebase` package
- Use Gemini through the Firebase-managed proxy layer
- Protect production usage with Firebase App Check

### Model Task
- Accept the PDF as document input
- Accept account currency as supporting textual context
- Extract a single stock transaction from the PDF
- Return strict JSON output
- Return warnings or diagnostics when confidence is low or the result is ambiguous

### Client-Side Post-Validation
- Parse JSON safely
- Enforce schema validation on the returned object
- Normalize symbol casing and whitespace
- Normalize numbers to plain numeric values
- Ensure type is only `buy` or `sell`
- Ensure required fields are present before prefilling
- Reject ambiguous or multi-transaction outputs

## AI Prompt Design

### System Prompt Requirements
- You are extracting a single stock transaction from a broker statement PDF.
- Return valid JSON only.
- Do not include explanations outside JSON.
- If more than one transaction appears, return an error state instead of guessing.
- Do not invent fields that are not grounded in the document.
- Use the provided account currency unless the document clearly contradicts it.

### Suggested Output Schema
```json
{
  "parsedTransaction": {
    "transactionDate": "2026-04-07",
    "type": "buy",
    "symbol": "AAPL",
    "quantity": 10,
    "price": 123.45,
    "fees": 1.5,
    "notes": "Imported from PDF"
  },
  "confidence": 0.92,
  "warnings": [],
  "diagnostics": [
    "Matched a single purchase confirmation section"
  ]
}
```

### Error Contract
```json
{
  "code": "no-single-transaction-found",
  "message": "The AI parser could not identify exactly one transaction.",
  "diagnostics": [
    "Multiple candidate transaction sections were detected"
  ]
}
```

### Guardrail Instructions
- If no transaction is found, return a structured error payload.
- If more than one transaction is found, return a structured error payload.
- If price is not explicit but total and quantity are present, compute price if confidence is high.
- If any transaction property is not found in the PDF, set it to null in the returned JSON.