import { AppRecord, SupplierRecord, Payment } from '../types';

export function migrateRecords(records: AppRecord[]): AppRecord[] {
  // Perform deep migration on each supplier record
  return records.map(record => {
    if (record.type === 'supplier') {
      const supplier = record as SupplierRecord;
      if (!supplier.payments) {
        const payments: Payment[] = [];
        if (supplier.status === 'paid') {
          payments.push({
            id: 'migrated_' + Math.random().toString(36).substr(2, 9),
            amount: Math.round(supplier.amount || 0),
            date: supplier.dueDate || new Date().toISOString().split('T')[0],
            method: 'Cash',
            note: 'Migrated from simple paid status',
            createdAt: new Date().toISOString()
          });
        }
        return {
          ...supplier,
          payments
        };
      }
    }
    return record;
  });
}

export function handleSchemaMigration(rawRecordsJson: string | null): AppRecord[] {
  if (!rawRecordsJson) return [];
  try {
    const parsed = JSON.parse(rawRecordsJson) as AppRecord[];
    const schemaVersion = localStorage.getItem('pharmacy_schema_version');
    
    if (schemaVersion !== '1') {
      // Back up existing data
      localStorage.setItem('pharmacy_records_backup_pre_v1', rawRecordsJson);
      
      const migrated = migrateRecords(parsed);
      
      // Save migrated
      localStorage.setItem('pharmacy_records', JSON.stringify(migrated));
      localStorage.setItem('pharmacy_schema_version', '1');
      return migrated;
    }
    
    return parsed;
  } catch (err) {
    console.error('Error during schema migration:', err);
    try {
      return JSON.parse(rawRecordsJson) as AppRecord[];
    } catch {
      return [];
    }
  }
}
