import { AppRecord, CustomerRecord, SupplierRecord } from './types';
import { format, parseISO } from 'date-fns';

/**
 * Creates a beautiful, customized Google Spreadsheet with "Customers" and "Suppliers" sheets.
 */
export async function createSpreadsheet(accessToken: string): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: {
        title: `AsquafMedical Tracker (${format(new Date(), 'dd MMM yyyy')})`
      },
      sheets: [
        {
          properties: {
            title: 'Customers',
            gridProperties: {
              frozenRowCount: 1
            }
          }
        },
        {
          properties: {
            title: 'Suppliers',
            gridProperties: {
              frozenRowCount: 1
            }
          }
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create spreadsheet: ${errText}`);
  }

  const data = await response.json();
  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`
  };
}

/**
 * Syncs the provided records into the designated sheets.
 */
export async function syncToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  records: AppRecord[]
): Promise<void> {
  const customers = records.filter(r => r.type === 'customer') as CustomerRecord[];
  const suppliers = records.filter(r => r.type === 'supplier') as SupplierRecord[];

  const customerRows = [
    ['Customer Name', 'Phone Number', 'Medicine/Description', 'Quantity', 'Amount (PKR)', 'Date Taken', 'Expected Return Date', 'Status'],
    ...customers.map(c => [
      c.customerName,
      c.phoneNumber,
      c.description,
      c.quantity || '-',
      c.amount,
      format(parseISO(c.date), 'yyyy-MM-dd'),
      format(parseISO(c.dueDate), 'yyyy-MM-dd'),
      c.status.toUpperCase()
    ])
  ];

  const supplierRows = [
    ['Supplier/Wholesaler Name', 'Medicine/Description', 'Quantity/Detail', 'Amount (PKR)', 'Purchase Date', 'Due Date', 'Status'],
    ...suppliers.map(s => {
      const displayDesc = s.items && s.items.length > 0
        ? s.items.map(item => `${item.name} (Rs. ${item.price.toLocaleString()})`).join(', ')
        : s.description;

      const displayQty = s.items && s.items.length > 0
        ? s.items.map(item => `${item.name}: ${item.quantity || '1'}`).join(', ')
        : (s.quantity || '-');

      return [
        s.supplierName,
        displayDesc,
        displayQty,
        s.amount,
        format(parseISO(s.date), 'yyyy-MM-dd'),
        format(parseISO(s.dueDate), 'yyyy-MM-dd'),
        s.status.toUpperCase()
      ];
    })
  ];

  // We write via clear + update or batch update
  // Let's clear sheets first to overwrite nicely
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Customers!A1:Z1000:clear`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Suppliers!A1:Z1000:clear`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  // Now perform value updates
  const updateBody = {
    valueInputOption: 'USER_ENTERED',
    data: [
      {
        range: 'Customers!A1',
        majorDimension: 'ROWS',
        values: customerRows
      },
      {
        range: 'Suppliers!A1',
        majorDimension: 'ROWS',
        values: supplierRows
      }
    ]
  };

  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    // In case the sheets were deleted from spreadsheet, let's try pushing basic Sheet1
    throw new Error(`Failed to sync data: ${errText}`);
  }
}
