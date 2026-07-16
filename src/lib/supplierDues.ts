import { parseISO, differenceInDays, startOfDay, isSameDay, isBefore } from 'date-fns';
import { SupplierRecord, Payment } from '../types';

export function getSupplierDueCalculations(record: SupplierRecord, todayDate: Date = new Date()) {
  const originalAmount = Math.round(record.amount || 0);
  const payments = record.payments || [];

  // Reversals list
  const reversedIds = new Set<string>();
  payments.forEach(p => {
    if (p.reversesPaymentId) {
      reversedIds.add(p.reversesPaymentId);
    }
  });

  let paid = 0;
  payments.forEach(p => {
    // If this payment is reversed, or is itself a reversal, don't count it towards paid sum
    if (reversedIds.has(p.id) || p.reversesPaymentId) {
      return;
    }
    paid += Math.round(p.amount || 0);
  });

  const remaining = originalAmount - paid;

  const dueDate = startOfDay(parseISO(record.dueDate));
  const today = startOfDay(todayDate);

  let status: 'settled' | 'overdue' | 'due-today' | 'not-due' = 'not-due';
  
  if (remaining <= 0) {
    status = 'settled';
  } else if (isSameDay(dueDate, today)) {
    status = 'due-today';
  } else if (isBefore(dueDate, today)) {
    status = 'overdue';
  } else {
    status = 'not-due';
  }

  const daysDiff = differenceInDays(dueDate, today);

  return {
    originalAmount,
    paid,
    remaining,
    status,
    daysDiff,
  };
}
