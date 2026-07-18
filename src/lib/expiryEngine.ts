// Expiry Pro Math Engine
import { ReturnPolicy, RETURN_POLICIES } from './returnPolicies';
import { InvoiceLine } from './parseInvoice';

export type ExpiryState = 'ANYTIME' | 'INTIMATION_OPEN' | 'INTIMATION_MISSED' | 'GRACE_OPEN' | 'DEAD' | 'ALL_CLEAR';

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function getDaysInMonth(year: number, month: number): number {
  // month is 0-indexed (0 = Jan, 11 = Dec)
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 1 && isLeapYear(year)) {
    return 29;
  }
  return days[month];
}

/**
 * Adds or subtracts months from a date in YYYY-MM-DD format.
 * Implements calendar-correct month clamping (e.g. 31 Aug - 6 months = 28 Feb in non-leap year).
 */
export function addMonths(dateStr: string, months: number): string {
  const parts = dateStr.split('-');
  let year = parseInt(parts[0], 10);
  let month = parseInt(parts[1], 10) - 1; // to 0-indexed
  const day = parseInt(parts[2], 10);

  month += months;
  while (month > 11) {
    month -= 12;
    year += 1;
  }
  while (month < 0) {
    month += 12;
    year -= 1;
  }

  const maxDays = getDaysInMonth(year, month);
  const targetDay = Math.min(day, maxDays);
  
  const paddedMonth = String(month + 1).padStart(2, '0');
  const paddedDay = String(targetDay).padStart(2, '0');
  return `${year}-${paddedMonth}-${paddedDay}`;
}

/**
 * Returns difference in calendar days between fromStr and toStr (both in YYYY-MM-DD format).
 */
export function getDaysDiff(fromStr: string, toStr: string): number {
  const fromParts = fromStr.split('-').map(Number);
  const toParts = toStr.split('-').map(Number);
  const fromDate = new Date(fromParts[0], fromParts[1] - 1, fromParts[2]);
  const toDate = new Date(toParts[0], toParts[1] - 1, toParts[2]);
  const diffTime = toDate.getTime() - fromDate.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

export interface DerivedExpiryInfo {
  state: ExpiryState;
  expiryDate: string;
  intimateBy: string | null;
  graceEnds: string;
  daysToExpiry: number;
  daysToIntimation: number | null;
  daysToGrace: number;
  totalLoss: number; // qty * unitCost (excludes bonus)
  recoverableAmount: number; // totalLoss if not DEAD, else 0
}

/**
 * Compute the state of a single invoice line item.
 */
export function computeExpiryState(
  item: InvoiceLine,
  policy: ReturnPolicy | null | undefined,
  todayStr: string
): DerivedExpiryInfo {
  const expiryDate = item.expiry;
  const totalLoss = item.qty * item.unitCost;

  // Defaults if no policy exists
  if (!policy) {
    // If we don't have a policy, treat as ALL_CLEAR or general state, but flag it
    return {
      state: 'ALL_CLEAR',
      expiryDate,
      intimateBy: null,
      graceEnds: expiryDate,
      daysToExpiry: getDaysDiff(todayStr, expiryDate),
      daysToIntimation: null,
      daysToGrace: getDaysDiff(todayStr, expiryDate),
      totalLoss,
      recoverableAmount: totalLoss
    };
  }

  const { intimation_months, grace_months } = policy;
  
  const intimateBy = intimation_months !== null ? addMonths(expiryDate, -intimation_months) : null;
  const graceEnds = addMonths(expiryDate, grace_months);

  const daysToExpiry = getDaysDiff(todayStr, expiryDate);
  const daysToGrace = getDaysDiff(todayStr, graceEnds);
  const daysToIntimation = intimateBy !== null ? getDaysDiff(todayStr, intimateBy) : null;

  let state: ExpiryState;

  // 1. DEAD -> today > graceEnds
  if (daysToGrace < 0) {
    state = 'DEAD';
  } 
  // 2. If it's anytime policy (intimation_months is null)
  else if (intimation_months === null) {
    state = 'ANYTIME';
  } 
  // 3. Physical grace open (expired but grace still open)
  else if (daysToExpiry < 0 && daysToGrace >= 0) {
    state = 'GRACE_OPEN';
  } 
  // 4. Intimation missed (today > intimateBy but today <= expiry)
  else if (daysToIntimation !== null && daysToIntimation < 0 && daysToExpiry >= 0) {
    state = 'INTIMATION_MISSED';
  } 
  // 5. Intimation still open
  else {
    // Threshold of 60 days to intimation -> ALL_CLEAR
    if (daysToIntimation !== null && daysToIntimation > 60) {
      state = 'ALL_CLEAR';
    } else {
      state = 'INTIMATION_OPEN';
    }
  }

  const recoverableAmount = state === 'DEAD' ? 0 : totalLoss;

  return {
    state,
    expiryDate,
    intimateBy,
    graceEnds,
    daysToExpiry,
    daysToIntimation,
    daysToGrace,
    totalLoss,
    recoverableAmount
  };
}
