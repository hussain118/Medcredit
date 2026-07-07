import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Language = 'en' | 'ur';

export interface AppSettings {
  pharmacyName: string;
  reminderTime: string;
  language: Language;
  googleSheetsId?: string;
  googleSheetsAutoSync?: boolean;
  googleSheetsUrl?: string;
}

export type RecordStatus = 'pending' | 'due-today' | 'overdue' | 'paid';

export interface MedicineItem {
  id: string;
  name: string;
  quantity: string;
  price: number;
}

export interface BaseRecord {
  id: string;
  description: string;
  amount: number;
  date: string;
  dueDate: string;
  status: RecordStatus;
  type: 'customer' | 'supplier';
  quantity?: string;
  items?: MedicineItem[];
  attachmentUrl?: string;
  attachmentName?: string;
}

export interface CustomerRecord extends BaseRecord {
  type: 'customer';
  customerName: string;
  phoneNumber: string;
}

export interface SupplierRecord extends BaseRecord {
  type: 'supplier';
  supplierName: string;
}

export type AppRecord = CustomerRecord | SupplierRecord;

export const TRANSLATIONS = {
  en: {
    appName: 'AsquafMedical',
    customers: 'Customers',
    suppliers: 'Suppliers',
    settings: 'Settings',
    customerName: 'Customer Name',
    supplierName: 'Supplier Name',
    phoneNumber: 'Phone Number',
    medicineDesc: 'Medicine / Description',
    quantity: 'Quantity',
    amount: 'Amount (PKR)',
    medicineName: 'Medicine Name',
    addMedicine: 'Add Medicine Row',
    price: 'Price',
    totalAmount: 'Total Amount (PKR)',
    dueDate: 'Due Date',
    expectedDate: 'Expected Return Date',
    purchaseDate: 'Purchase Date',
    addRecord: 'Add Record',
    markPaid: 'Mark Paid',
    cleared: 'Cleared',
    dueToday: 'Due Today',
    overdue: 'Overdue',
    notDue: 'Not Due',
    daysLeft: 'days left',
    daysOverdue: 'days overdue',
    callNow: 'Call Now',
    sendWhatsApp: 'Send WhatsApp',
    pharmacyNameLabel: 'Pharmacy Name',
    reminderTimeLabel: 'Daily Reminder Time',
    languageLabel: 'Language',
    clearAllData: 'Clear All Data',
    exportData: 'Export Data (CSV)',
    saveSettings: 'Save Settings',
    connectGoogleSheets: 'Connect Google Sheets',
    googleSheetsConnected: 'Connected to Google',
    googleSheetsDocId: 'Google Sheet ID',
    syncNow: 'Sync to Google Sheets',
    syncCompleted: 'Sync completed successfully!',
    createSpreadsheet: 'Create New Google Sheet',
    disconnect: 'Disconnect Google',
    autoSyncLabel: 'Auto-Sync on Changes',
    viewSheet: 'Open Google Sheet',
    whatsappTemplate: (name: string, pharmacy: string, amount: number) => 
      `Dear ${name}, this is a reminder from ${pharmacy}. Your pending amount of Rs. ${amount} is due today. Please arrange payment. Thank you.`,
    summaryTitle: 'Daily Summary',
    noRecords: 'No records found',
    dueIn: 'Due in',
    attachment: 'Attachment',
    addAttachment: 'Add Receipt / Prescription',
    dragDropFile: 'Drag & drop image here or click to select',
    removeAttachment: 'Remove Attachment',
    viewAttachment: 'View Receipt',
  },
  ur: {
    appName: 'AsquafMedical',
    customers: 'گاہک',
    suppliers: 'سپلائرز',
    settings: 'سیٹنگز',
    customerName: 'گاہک کا نام',
    supplierName: 'سپلائر کا نام',
    phoneNumber: 'فون نمبر',
    medicineDesc: 'ادویات / تفصیل',
    quantity: 'مقدار (تعداد)',
    amount: 'رقم (روپے)',
    medicineName: 'دوا کا نام',
    addMedicine: 'مزید دوا شامل کریں',
    price: 'قیمت',
    totalAmount: 'کل رقم (روپے)',
    dueDate: 'ادائیگی کی تاریخ',
    expectedDate: 'واپسی کی متوقع تاریخ',
    purchaseDate: 'خریداری کی تاریخ',
    addRecord: 'ریکارڈ شامل کریں',
    markPaid: 'ادائیگی ہو گئی',
    cleared: 'ادائیگی شدہ',
    dueToday: 'آج واجب الادا',
    overdue: 'میعاد ختم',
    notDue: 'ابھی نہیں',
    daysLeft: 'دن باقی',
    daysOverdue: 'دن گزر گئے',
    callNow: 'کال کریں',
    sendWhatsApp: 'واٹس ایپ پیغام',
    pharmacyNameLabel: 'فارمیسی کا نام',
    reminderTimeLabel: 'روزانہ یاد دہانی کا وقت',
    languageLabel: 'زبان',
    clearAllData: 'تمام ڈیٹا صاف کریں',
    exportData: 'ڈیٹا ایکسپورٹ کریں (CSV)',
    saveSettings: 'سیٹنگز محفوظ کریں',
    connectGoogleSheets: 'گوگل شیٹس منسلک کریں',
    googleSheetsConnected: 'گوگل اکاؤنٹ مربوط ہے',
    googleSheetsDocId: 'گوگل شیٹ آئی ڈی',
    syncNow: 'گوگل شیٹس سنک کریں',
    syncCompleted: 'کامیابی سے سنک ہو گیا!',
    createSpreadsheet: 'نئی گوگل شیٹ بنائیں',
    disconnect: 'گوگل لنک منقطع کریں',
    autoSyncLabel: 'تبدیلیوں پر خود کار سنک',
    viewSheet: 'گوگل شیٹ کھولیں',
    whatsappTemplate: (name: string, pharmacy: string, amount: number) => 
      `محترم ${name}، یہ ${pharmacy} کی طرف سے یاد دہانی ہے۔ آپ کی Rs. ${amount} کی رقم آج واجب الادا ہے۔ برائے کرم ادائیگی کا انتظام کریں۔ شکریہ۔`,
    summaryTitle: 'روزانہ کا خلاصہ',
    noRecords: 'کوئی ریکارڈ نہیں ملا',
    dueIn: 'باقی وقت',
    attachment: 'منسلک فائل',
    addAttachment: 'رسید / تصویر شامل کریں',
    dragDropFile: 'تصویر یہاں ڈریگ کریں یا منتخب کرنے کے لیے کلک کریں',
    removeAttachment: 'فائل حذف کریں',
    viewAttachment: 'رسید دیکھیں',
  }
};
