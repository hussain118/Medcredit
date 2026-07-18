// Invoice Demo Fixtures
import { InvoiceData } from '../lib/parseInvoice';

export const DEMO_TODAY = '2026-07-18';

export const BILL_A: InvoiceData = {
  invoiceNumber: '8306476042',
  distributorName: 'IBL Operations (Pvt) Ltd',
  date: '2026-07-10',
  paymentMode: 'Cash',
  lines: [
    {
      brand: "Vitrumod Geriatric Tab 30's (PAK)",
      manufacturer: null, // unresolved originally, will trigger "needs mapping/policy" unless mapped
      batch: 'ADH007',
      qty: 10,
      bonus: 1,
      unitCost: 482.63,
      expiry: '2028-05-08' // 2028-05-08 (DD.MM.YYYY printed as 08.05.2028)
    }
  ]
};

export const BILL_B: InvoiceData = {
  invoiceNumber: '8306499001',
  distributorName: 'IBL Operations (Pvt) Ltd',
  date: '2026-07-10',
  paymentMode: 'Cash',
  lines: [
    {
      brand: "Brufen 400mg Tab 30's",
      manufacturer: 'abbott laboratories',
      batch: 'BR2291',
      qty: 20,
      bonus: 2,
      unitCost: 350.00,
      expiry: '2027-02-28' // 6m intimation / 1m grace -> intimate by 2026-08-28 (41 days left @ 2026-07-18)
    },
    {
      brand: "Lipiget 10mg Tab 30's",
      manufacturer: 'gsk pakistan',
      batch: 'LP3310',
      qty: 18,
      bonus: 0,
      unitCost: 280.00,
      expiry: '2027-01-10' // 6m intimation / 1m grace -> intimate by 2026-07-10 (passed, not expired)
    },
    {
      brand: "Panadol Extra Tab 20's",
      manufacturer: 'haleon pakistan',
      batch: 'PN8830',
      qty: 15,
      bonus: 0,
      unitCost: 120.00,
      expiry: '2026-11-10' // 6m intimation / 1m grace -> intimate by 2026-05-10 (passed, not expired)
    },
    {
      brand: "CAC-1000 Effervescent 10's",
      manufacturer: 'haleon pakistan',
      batch: 'CC4471',
      qty: 30,
      bonus: 3,
      unitCost: 220.00,
      expiry: '2026-06-30' // 6m intimation / 1m grace -> grace ends 2026-07-30 (12 days left, expired)
    },
    {
      brand: "Empaa 10mg Tab 14's",
      manufacturer: 'horizon pharmaceuticals',
      batch: 'EM0091',
      qty: 12,
      bonus: 0,
      unitCost: 450.00,
      expiry: '2026-07-05' // null intimation / 2m grace -> grace ends 2026-09-05 (49 days left, anytime return)
    },
    {
      brand: "Rivotril 2mg Tab 30's",
      manufacturer: 'martin dow group',
      batch: 'RV1120',
      qty: 10,
      bonus: 0,
      unitCost: 180.00,
      expiry: '2026-05-20' // 6m intimation / 1m grace -> grace ended 2026-06-20 (DEAD)
    },
    {
      brand: "Velosef 500mg Cap 12's",
      manufacturer: 'gsk pakistan',
      batch: 'VL7781',
      qty: 25,
      bonus: 2,
      unitCost: 310.00,
      expiry: '2028-09-01' // 6m intimation / 1m grace -> ALL_CLEAR (far off)
    },
    {
      brand: "Unknown Tab 10mg",
      manufacturer: null, // triggers NEEDS_POLICY mapping
      batch: 'UK9912',
      qty: 10,
      bonus: 0,
      unitCost: 150.00,
      expiry: '2026-12-01'
    }
  ]
};
