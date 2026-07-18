// Invoice Parser and Interface definitions

export interface InvoiceLine {
  brand: string;
  manufacturer: string | null;
  batch: string;
  qty: number;
  bonus: number;
  unitCost: number; // Trade Price (T.P)
  expiry: string;   // ISO yyyy-mm-dd
}

export interface InvoiceData {
  invoiceNumber: string;
  distributorName: string;
  date: string; // ISO yyyy-mm-dd
  paymentMode: 'Cash' | 'Cheque';
  lines: InvoiceLine[];
}

/**
 * Parses a date string in DD.MM.YYYY or similar format to ISO YYYY-MM-DD.
 */
export function parseDateToISO(dateStr: string): string {
  if (!dateStr) return "";
  
  // If it's already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Handle DD.MM.YYYY or DD-MM-YYYY or DD/MM/YYYY
  const match = dateStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    const [_, day, month, year] = match;
    const paddedDay = day.padStart(2, '0');
    const paddedMonth = month.padStart(2, '0');
    return `${year}-${paddedMonth}-${paddedDay}`;
  }

  return dateStr;
}

/**
 * Parse Invoice.
 * In a real production app, this would use a vision model or OCR.
 * For this build, we return the hand-entered fixture matching the input query.
 */
export function parseInvoice(raw: any): InvoiceData {
  // If it's already structured, return it.
  return raw as InvoiceData;
}
