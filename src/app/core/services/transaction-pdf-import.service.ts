import { Injectable } from '@angular/core';
import { getApp } from '@angular/fire/app';
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from 'firebase/ai';
import {
  ImportCandidate,
  TransactionFormPrefillPayload,
  TransactionImportResult,
} from '../models/transaction-import.model';
import { TransactionType } from '../models/transaction.model';
import { TrackedSymbol } from '../models/tracked-symbol.model';

export class TransactionPdfImportError extends Error {
  constructor(
    message: string,
    readonly diagnostics: string[] = [],
    readonly code?: string
  ) {
    super(message);
    this.name = 'TransactionPdfImportError';
  }
}

@Injectable({ providedIn: 'root' })
export class TransactionPdfImportService {
  private static readonly MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
  private static readonly RESPONSE_SCHEMA = Schema.object({
    properties: {
      parsedTransaction: Schema.object({
        properties: {
          transactionDate: Schema.string({ nullable: true }),
          type: Schema.enumString({ enum: ['buy', 'sell'], nullable: true }),
          symbol: Schema.string({ nullable: true }),
          fullName: Schema.string({ nullable: true }),
          quantity: Schema.number({ nullable: true }),
          price: Schema.number({ nullable: true }),
          fees: Schema.number({ nullable: true }),
          notes: Schema.string({ nullable: true }),
        },
      }),
      confidence: Schema.number(),
      warnings: Schema.array({ items: Schema.string() }),
      diagnostics: Schema.array({ items: Schema.string() }),
      code: Schema.string(),
      message: Schema.string(),
    },
    optionalProperties: ['parsedTransaction', 'warnings', 'diagnostics', 'code', 'message'],
  });

  private static readonly SYSTEM_PROMPT = `You extract a single stock transaction from a broker statement PDF.
Return valid JSON only and do not include markdown or explanations.
Do not invent values that are not grounded in the document.
If no transaction data can be found at all, return an error payload.
If any transaction property is missing, set it to null.

Symbol matching rules (CRITICAL - ACCURACY IS ESSENTIAL):
- You will receive a list of registered symbols with both ticker symbol and full name.
- EXACT FULL STRING MATCHING ONLY. Do NOT use fuzzy matching, semantic matching, similarity matching, or substring matching.
- This is CRITICAL. If you match the wrong security, you will cause serious data errors and the user will be fired from their job.
- Ticker symbol: The ENTIRE ticker must match character-for-character (case-insensitive OK). For example, if the PDF says "VTSAX" and the list has "VTSAX", match it. If the PDF says "VTSAX" and the list has "VTS", do NOT match - these are DIFFERENT. If the PDF says "SYGNIA ITRIX MSCI US" and the list has "Sygnia Itrix 4th Industrial Revolution Global Equity ETF", do NOT match - the ticker is different from the fund name, these are DIFFERENT securities.
- Full name: The ENTIRE full name must match character-for-character (case-insensitive OK). Do not match if it's only a substring or partial name.
- DO NOT match based on shared words or substrings. For example, "Sygnia Itrix MSCI US" and "Sygnia Itrix 4th Industrial Revolution Global Equity ETF" both contain "Sygnia Itrix" but are COMPLETELY DIFFERENT securities and must NEVER be matched together.
- DO NOT match based on semantic similarity or meaning.
- If the document contains a ticker symbol, search the registered list for an EXACT COMPLETE match on that ticker only.
- If the document contains a company/fund name, search the registered list for an EXACT COMPLETE match on that full name only.
- If no exact complete match is found, leave symbol as null. Do not guess. It is better to leave symbol null than to match the wrong security.

Identity rules:
- Populate at least one of symbol or fullName whenever the traded security can be identified.
- If both are present in the document, return both.
- If the symbol is not present but a clear security/fund/company name is present, set fullName and leave symbol as null.
- If only a symbol is present, set symbol and leave fullName as null.
- NEVER return a symbol that does not match the registered symbols list. If unsure, leave symbol as null.

Quantity rules:
- quantity is the total number of units/shares purchased or sold.
- Statements always list whole shares and fractional shares separately. Fractional shares may be labelled FSRs, Fractional Share Rights, or similar.
- Fractional shares appear as decimals often without a leading zero and decimal point, for example: "375". Interpret this as 0.375.
- Fractional shares can also appear as integer digits next to an FSR label (for example "FSRs 5532"). In this case treat the digits as the fractional part: 5532 means 0.5532.
- Always add whole shares and fractional shares together. Never return only the whole-share count.
- Example: 10 Shares + 0.5 FSRs = quantity 10.5.
- Example: 42 Shares + FSRs 5532 = quantity 42.5532.
- Do NOT return only the whole shares and omit the FSRs, even if they are on a separate line item. Always sum them up and return the total quantity. For example, if the statement shows "10 Shares" and "0.5 FSRs", you should return quantity: 10.5, not just 10.
- Do not treat a numeric value attached to an FSR label as a reference code unless the PDF explicitly says it is a reference/code/id field.
- If you do not include the FSR amount in quantity, the value will be wrong, and the end user will be fired for your mistake.

Price rules:
- price is the per-unit trade price in the account currency.
- The trade price is usually shown as as cents, check the total Shares, and the Total Transaction Cost if available, to determine confirm this, and if so, divide the price by 100 to convert to Rand (or equivalent base currency). For example, if the statement shows "10 Shares" and a price of "1234", but the Total Transaction Cost is "R 123.40", this implies that the price is in cents and should be converted to 12.34.
- Never return a price in cents — always return the Rand (or equivalent base currency) value.

Fee rules:
- If an explicit Total Transaction Cost (or equivalent total cash outlay/proceeds) is present, prefer it as the source of truth.
- When Total Transaction Cost is present and quantity and price are known, compute fees as: fees = Total Transaction Cost - (quantity × price).
- If this computed fees value conflicts with summed line-item fees, prefer the total transaction cost derived value and note the discrepancy in warnings.
- Sum ALL charges, commissions, levies, and taxes on those charges into a single fees value.
- Include items such as: Broker Commission, Settlement Fee, Investor Protection Levy, VAT on commission, VAT on fees, Securities Transfer Tax, STRATE fees, or any other line item that represents a cost of the transaction.
- Do not include the cost of the shares themselves (quantity × price) as a fee.`;

  private static readonly USER_PROMPT_TEMPLATE = `Extract a stock transaction from this PDF and return JSON in the success shape below.

REGISTERED SYMBOLS TO MATCH AGAINST:
{SYMBOLS_LIST}

Rules:
- Always use the success shape. Only use the error shape if no transaction data can be found at all.
- Set any field you cannot find to null. Never omit a field from parsedTransaction.
- Do not put field values inside warnings or diagnostics — always put them in parsedTransaction.
- transactionDate must be YYYY-MM-DD.
- CRITICAL - SYMBOL MATCHING (ACCURACY IS ESSENTIAL): Use EXACT FULL STRING MATCHING ONLY. This is critical - incorrect matches cause serious data errors and the user will lose their job. Do NOT use fuzzy matching, semantic matching, substring matching, or similarity-based matching. Look at the ticker symbol or company name in the PDF. Search the registered symbols list and ONLY match if the ENTIRE string matches character-for-character (case-insensitive is OK). For example, if the PDF shows ticker "SYGNIA ITRIX MSCI US" but the list has "Sygnia Itrix 4th Industrial Revolution Global Equity ETF", do NOT match - these are two COMPLETELY DIFFERENT securities. Just because both contain "Sygnia Itrix" does NOT mean they should be matched. If you cannot find an EXACT COMPLETE match (either full ticker code match OR full name match), leave symbol as null. It is ALWAYS better to leave symbol null than to match the wrong security.
- If the document shows a company name that matches a registered fullName entry EXACTLY (case-insensitive and full string), use the corresponding ticker symbol for the symbol field.
- Security identity: populate symbol or fullName (at least one when identifiable). If both are present, return both.
- quantity: whole shares + fractional shares (FSRs) must always be added together. Never return only the whole-share count even if FSRs appear on a separate line.
- quantity: if fractional shares are written like ". 375" (space after decimal and no leading zero), interpret as 0.375 and include in the total quantity.
- quantity: if FSR is shown as integer digits (for example "FSRs 5532"), interpret as fractional digits and convert to 0.5532 before adding to whole shares.
- quantity: do not classify numeric FSR values as reference numbers unless the document explicitly labels them as reference/code/id.
- quantity: if the final quantity has no fractional component, include a diagnostics note explaining FSR handling (what was searched, what was found, and why no FSR amount was included).
- quantity: if any FSR/Fractional Share Rights text is found but not included in quantity, add a warning with the exact FSR text snippet and reason.
- price: per-unit trade price in the base currency. If trade price is an integer, treat as cents and divide by 100. If it has decimals, treat as rands (do not divide).
- if a Total Transaction Cost (or equivalent final total) is present, use it for fees in preference to fee line-item summation.
- if no Total Transaction Cost is present, sum every charge, commission, levy, and tax on fees into one number. Do not include the share cost itself.

Success shape:
{
  "parsedTransaction": {
    "transactionDate": "YYYY-MM-DD or null",
    "type": "buy" | "sell" | null,
    "symbol": "string or null",
    "fullName": "string or null",
    "quantity": number or null,
    "price": number or null,
    "fees": number or null,
    "notes": "string or null"
  },
  "confidence": number between 0 and 1,
  "warnings": ["string"],
  "diagnostics": ["string"]
}

Error shape (only when no transaction data exists at all):
{
  "code": "no-single-transaction-found",
  "message": "short explanation",
  "diagnostics": ["string"]
}`;

  private static buildSymbolsListForPrompt(symbols: TrackedSymbol[]): string {
    if (symbols.length === 0) {
      return '(No registered symbols yet - leave symbol as null if not found in document)';
    }

    const symbolLines = symbols.map(s => `- ${s.symbol}: ${s.fullName}`).join('\n');
    return symbolLines;
  }

  async importSingleTransaction(file: File, accountCurrency: string, model: string, symbols: TrackedSymbol[]): Promise<TransactionImportResult> {
    const warnings: string[] = [];

    this.validateFile(file, warnings);
    const responsePayload = await this.runAiExtraction(file, accountCurrency, model, symbols);
    return this.normalizeAndValidate(responsePayload, warnings);
  }

  toFormPrefill(candidate: ImportCandidate): TransactionFormPrefillPayload {
    return {
      transactionDate: candidate.transactionDate,
      type: candidate.type,
      symbol: candidate.symbol,
      fullName: candidate.fullName,
      quantity: candidate.quantity,
      price: candidate.price,
      fees: candidate.fees,
      notes: candidate.notes,
    };
  }

  private validateFile(file: File, warnings: string[]): void {
    if (!file) {
      throw new Error('No file selected.');
    }

    const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!looksLikePdf) {
      throw new Error('Only PDF files are supported.');
    }

    if (file.size > TransactionPdfImportService.MAX_FILE_SIZE_BYTES) {
      warnings.push('This PDF is larger than 10 MB, so parsing may be slower.');
    }
  }

  private async runAiExtraction(file: File, accountCurrency: string, modelName: string, symbols: TrackedSymbol[]): Promise<unknown> {
    const fileData = await this.toBase64(file);
    const symbolsList = TransactionPdfImportService.buildSymbolsListForPrompt(symbols);
    const userPrompt = TransactionPdfImportService.USER_PROMPT_TEMPLATE.replace('{SYMBOLS_LIST}', symbolsList);

    const ai = getAI(getApp(), { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, {
      model: modelName,
      systemInstruction: TransactionPdfImportService.SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: TransactionPdfImportService.RESPONSE_SCHEMA,
      },
    });

    let response: Awaited<ReturnType<typeof model.generateContent>>;
    try {
      response = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${userPrompt}\n\nAccount currency: ${accountCurrency}.`,
              },
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: fileData,
                },
              },
            ],
          },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const sdkDiagnostics = this.extractSdkErrorDiagnostics(error);
      const requestDiagnostics = [
        `Model: ${modelName}`,
        `File: ${file.name} (${Math.round(file.size / 1024)} KB)`,
        `Account currency: ${accountCurrency}`,
      ];

      console.error('[TransactionPdfImportService] generateContent failed', {
        modelName,
        fileName: file.name,
        fileSizeBytes: file.size,
        accountCurrency,
        error,
      });

      if (message.includes("reading 'some'") || message.includes('INVALID_CONTENT')) {
        const fallbackProbe = await this.tryFallbackProbe(ai, fileData, accountCurrency, modelName, symbols);
        if (fallbackProbe.payload) {
          const payloadWithDiagnostics = this.appendFallbackDiagnosticsToPayload(
            fallbackProbe.payload,
            fallbackProbe.diagnostics
          );
          return payloadWithDiagnostics;
        }

        throw new TransactionPdfImportError(
          'The AI parser returned a malformed response body.',
          [
            'The Firebase AI SDK rejected the model response before it could be parsed.',
            ...requestDiagnostics,
            ...sdkDiagnostics,
            ...fallbackProbe.diagnostics,
          ],
          'malformed-response'
        );
      }

      throw new TransactionPdfImportError(
        message || 'The AI request failed before parsing could start.',
        [...requestDiagnostics, ...sdkDiagnostics],
        'ai-request-failed'
      );
    }

    const payload = this.extractResponseText(response.response);
    const finishReason = this.extractFinishReason(response.response);
    console.group('[TransactionPdfImportService] AI raw response');
    console.log('finish reason:', finishReason);
    console.log('raw text:', payload);
    console.log('candidate count:', response.response.candidates?.length ?? 0);
    console.groupEnd();

    if (!payload) {
      const diagnostics = finishReason ? [`Model finished with reason: ${finishReason}.`] : [];
      throw new TransactionPdfImportError(
        'The AI parser returned an empty response body.',
        diagnostics,
        'empty-response'
      );
    }

    let parsed: unknown;
    try {
      parsed = this.parseJsonLenient(payload);
    } catch {
      throw new TransactionPdfImportError('The AI parser returned non-JSON output.');
    }

    console.log('[TransactionPdfImportService] parsed payload:', parsed);
    return parsed;
  }

  private async tryFallbackProbe(
    ai: ReturnType<typeof getAI>,
    fileData: string,
    accountCurrency: string,
    modelName: string,
    symbols: TrackedSymbol[]
  ): Promise<{ diagnostics: string[]; payload?: unknown }> {
    const probeDiagnostics: string[] = [];
    const symbolsList = TransactionPdfImportService.buildSymbolsListForPrompt(symbols);
    const userPrompt = TransactionPdfImportService.USER_PROMPT_TEMPLATE.replace('{SYMBOLS_LIST}', symbolsList);

    const fallbackModel = getGenerativeModel(ai, {
      model: modelName,
      systemInstruction: TransactionPdfImportService.SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.1,
      },
    });

    try {
      const response = await fallbackModel.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${userPrompt}\n\nAccount currency: ${accountCurrency}.`,
              },
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: fileData,
                },
              },
            ],
          },
        ],
      });

      const finishReason = this.extractFinishReason(response.response);
      const payload = this.extractResponseText(response.response);
      const payloadPreview = this.toPreview(payload, 1200);

      console.groupCollapsed('[TransactionPdfImportService] Fallback probe response debug');
      console.log('finish reason:', finishReason);
      console.log('raw text preview:', payloadPreview);
      console.log('raw response object:', response.response);
      console.log('candidate summary:', this.summarizeCandidates(response.response));
      console.groupEnd();

      if (finishReason) {
        probeDiagnostics.push(`Fallback probe finish reason: ${finishReason}.`);
      }

      if (!payload) {
        probeDiagnostics.push(
          'Fallback probe (without response schema/mime constraints) also returned no text payload.'
        );
        return { diagnostics: probeDiagnostics };
      }

      probeDiagnostics.push(
        'Fallback probe returned text when schema/mime constraints were removed. This suggests strict response formatting may be the trigger for this PDF.'
      );
      probeDiagnostics.push(
        `Fallback raw text preview: ${payloadPreview || '[empty]'}`
      );

      try {
        const parsedPayload = this.parseJsonLenient(payload);
        probeDiagnostics.push('Fallback probe text appears to contain valid JSON.');
        return { diagnostics: probeDiagnostics, payload: parsedPayload };
      } catch {
        probeDiagnostics.push('Fallback probe text was not valid JSON.');
      }
    } catch (probeError) {
      const probeMessage = probeError instanceof Error ? probeError.message : String(probeError);
      probeDiagnostics.push(`Fallback probe failed: ${probeMessage}`);
      probeDiagnostics.push(...this.extractSdkErrorDiagnostics(probeError));
    }

    return { diagnostics: probeDiagnostics };
  }

  private appendFallbackDiagnosticsToPayload(rawPayload: unknown, diagnostics: string[]): unknown {
    if (!rawPayload || typeof rawPayload !== 'object') {
      return rawPayload;
    }

    const payload = rawPayload as {
      diagnostics?: unknown;
    };
    const existingDiagnostics = this.normalizeStringArray(payload.diagnostics);
    const mergedDiagnostics = [
      ...existingDiagnostics,
      'Import used fallback AI parsing mode because strict JSON schema parsing failed for this PDF.',
      ...diagnostics,
    ];

    return {
      ...(rawPayload as Record<string, unknown>),
      diagnostics: mergedDiagnostics,
    };
  }

  private normalizeAndValidate(rawPayload: unknown, initialWarnings: string[]): TransactionImportResult {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new TransactionPdfImportError('The AI parser returned an invalid payload.');
    }

    const payload = rawPayload as {
      parsedTransaction?: unknown;
      confidence?: unknown;
      warnings?: unknown;
      diagnostics?: unknown;
      code?: unknown;
      message?: unknown;
    };

    const diagnostics = this.normalizeStringArray(payload.diagnostics);
    if (typeof payload.code === 'string' || typeof payload.message === 'string') {
      throw new TransactionPdfImportError(
        typeof payload.message === 'string'
          ? payload.message
          : 'The AI parser could not identify exactly one transaction.',
        diagnostics,
        typeof payload.code === 'string' ? payload.code : undefined
      );
    }

    const parsedTransaction = this.normalizeParsedTransaction(payload.parsedTransaction, diagnostics);

    const missingFieldWarnings: string[] = [];
    if (!parsedTransaction.transactionDate) missingFieldWarnings.push('date');
    if (!parsedTransaction.type) missingFieldWarnings.push('type');
    if (!parsedTransaction.symbol && !parsedTransaction.fullName) {
      missingFieldWarnings.push('symbol/fullName');
    }
    if (parsedTransaction.quantity === undefined) missingFieldWarnings.push('quantity');
    if (parsedTransaction.price === undefined) missingFieldWarnings.push('price');

    const hasAnyField = Object.values(parsedTransaction).some((v) => v !== undefined);
    if (!hasAnyField) {
      throw new TransactionPdfImportError(
        'The AI parser could not extract any transaction fields from this PDF.',
        diagnostics
      );
    }

    const warnings = [
      ...initialWarnings,
      ...this.normalizeStringArray(payload.warnings),
      ...(missingFieldWarnings.length > 0
        ? [`The following field(s) could not be extracted and need manual entry: ${missingFieldWarnings.join(', ')}.`]
        : []),
    ];

    return {
      parsedTransaction,
      warnings,
      confidence: this.normalizeConfidence(payload.confidence),
      diagnostics,
    };
  }

  private normalizeParsedTransaction(raw: unknown, diagnostics: string[]): ImportCandidate {
    if (!raw || typeof raw !== 'object') {
      throw new TransactionPdfImportError('The AI parser did not return a transaction object.', diagnostics);
    }

    const value = raw as {
      transactionDate?: unknown;
      type?: unknown;
      symbol?: unknown;
      fullName?: unknown;
      quantity?: unknown;
      price?: unknown;
      fees?: unknown;
      notes?: unknown;
    };

    const type = this.normalizeType(value.type);
    const symbol = this.normalizeSymbol(value.symbol);
    const fullName = this.normalizeFullName(value.fullName);
    const quantity = this.normalizeNumber(value.quantity);
    const price = this.normalizeNumber(value.price);
    const fees = this.normalizeNumber(value.fees);
    const transactionDate = this.normalizeIsoDate(value.transactionDate);
    const notes = typeof value.notes === 'string' ? value.notes.trim() || undefined : undefined;

    if (quantity !== undefined && quantity <= 0) {
      throw new TransactionPdfImportError('The AI parser returned a non-positive quantity.', diagnostics);
    }
    if (price !== undefined && price < 0) {
      throw new TransactionPdfImportError('The AI parser returned a negative price.', diagnostics);
    }
    if (fees !== undefined && fees < 0) {
      throw new TransactionPdfImportError('The AI parser returned negative fees.', diagnostics);
    }

    return {
      transactionDate,
      type,
      symbol,
      fullName,
      quantity,
      price,
      fees,
      notes,
    };
  }

  private normalizeType(value: unknown): TransactionType | undefined {
    if (value !== 'buy' && value !== 'sell') {
      return undefined;
    }
    return value;
  }

  private normalizeSymbol(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim().toUpperCase();
    return normalized || undefined;
  }

  private normalizeFullName(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized || undefined;
  }

  private normalizeNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    return value;
  }

  private normalizeIsoDate(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const day = String(parsed.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private normalizeConfidence(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1, value));
  }

  private extractResponseText(response: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  }): string {
    const text = response.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();

    return text || '';
  }

  private extractFinishReason(response: {
    candidates?: Array<{
      finishReason?: string;
    }>;
  }): string | undefined {
    return response.candidates?.find((candidate) => typeof candidate.finishReason === 'string')?.finishReason;
  }

  private extractSdkErrorDiagnostics(error: unknown): string[] {
    if (!error || typeof error !== 'object') {
      return [];
    }

    const value = error as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      status?: unknown;
      details?: unknown;
      errorInfo?: unknown;
      customData?: unknown;
      cause?: unknown;
    };

    const diagnostics: string[] = [];
    if (typeof value.name === 'string' && value.name.trim()) {
      diagnostics.push(`Error name: ${value.name}`);
    }
    if (typeof value.code === 'string' && value.code.trim()) {
      diagnostics.push(`Error code: ${value.code}`);
    }
    if (typeof value.status === 'string' && value.status.trim()) {
      diagnostics.push(`Error status: ${value.status}`);
    }

    const details = this.toDiagnosticJson(value.details);
    if (details) {
      diagnostics.push(`Error details: ${details}`);
    }

    const errorInfo = this.toDiagnosticJson(value.errorInfo);
    if (errorInfo) {
      diagnostics.push(`Error info: ${errorInfo}`);
    }

    const customData = this.toDiagnosticJson(value.customData);
    if (customData) {
      diagnostics.push(`Error customData: ${customData}`);
    }

    const cause = this.toDiagnosticJson(value.cause);
    if (cause) {
      diagnostics.push(`Error cause: ${cause}`);
    }

    if (typeof value.message === 'string' && value.message.trim()) {
      diagnostics.push(`Error message: ${value.message}`);
    }

    return diagnostics;
  }

  private toDiagnosticJson(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed.slice(0, 600) : undefined;
    }

    if (typeof value !== 'object') {
      return String(value).slice(0, 600);
    }

    try {
      return JSON.stringify(value).slice(0, 600);
    } catch {
      return '[unserializable object]';
    }
  }

  private extractJsonObject(value: string): string | undefined {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return undefined;
    }

    return value.slice(start, end + 1).trim();
  }

  private stripMarkdownCodeFence(value: string): string {
    const trimmed = value.trim();
    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (!fencedMatch) {
      return value;
    }

    return fencedMatch[1];
  }

  private parseJsonLenient(value: string): unknown {
    const direct = value.trim();
    try {
      return JSON.parse(direct);
    } catch {
      // Try recovering when the model wraps JSON in markdown fences.
    }

    const withoutFence = this.stripMarkdownCodeFence(direct).trim();
    try {
      return JSON.parse(withoutFence);
    } catch {
      // Try recovering when JSON is embedded in other text.
    }

    const objectSlice = this.extractJsonObject(withoutFence);
    if (objectSlice) {
      return JSON.parse(objectSlice);
    }

    throw new Error('Unable to parse JSON payload.');
  }

  private summarizeCandidates(response: {
    candidates?: Array<{
      finishReason?: string;
      content?: {
        role?: string;
        parts?: Array<{
          text?: string;
          functionCall?: unknown;
          inlineData?: unknown;
        }>;
      };
    }>;
  }): Array<{
    index: number;
    finishReason?: string;
    role?: string;
    partCount: number;
    partKinds: string[];
  }> {
    return (
      response.candidates?.map((candidate, index) => {
        const parts = candidate.content?.parts ?? [];
        const partKinds = parts.map((part) => {
          if (typeof part.text === 'string') {
            return 'text';
          }
          if (part.functionCall) {
            return 'functionCall';
          }
          if (part.inlineData) {
            return 'inlineData';
          }
          return 'unknown';
        });

        return {
          index,
          finishReason: candidate.finishReason,
          role: candidate.content?.role,
          partCount: parts.length,
          partKinds,
        };
      }) ?? []
    );
  }

  private toPreview(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength)}...`;
  }

  private async toBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
  }
}