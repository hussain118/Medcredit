/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Store, 
  Settings as SettingsIcon, 
  Phone, 
  MessageCircle, 
  CheckCircle2, 
  Plus, 
  X,
  Languages,
  Trash2,
  Bell,
  Clock,
  ArrowRight,
  MoreVertical,
  FileSpreadsheet,
  LogIn,
  LogOut,
  Check,
  RefreshCw,
  ExternalLink,
  Paperclip,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, isToday, isPast, isBefore, addDays, parseISO, differenceInDays } from 'date-fns';
import { 
  AppRecord, 
  CustomerRecord, 
  SupplierRecord, 
  AppSettings, 
  TRANSLATIONS, 
  Language, 
  cn 
} from './types';
import { googleSignIn, logout, initAuth } from './auth';
import { 
  loadSettingsFromFirebase, 
  saveSettingsToFirebase, 
  loadRecordsFromFirebase, 
  saveRecordToFirebase, 
  deleteRecordFromFirebase 
} from './db';
import { createSpreadsheet, syncToSpreadsheet } from './googleSheets';
import { handleSchemaMigration, migrateRecords } from './lib/migration';
import { getSupplierDueCalculations } from './lib/supplierDues';

export default function App() {
  // State
  const [activeTab, setActiveTab] = useState<'customers' | 'suppliers' | 'settings'>('customers');
  const [records, setRecords] = useState<AppRecord[]>(() => {
    const saved = localStorage.getItem('pharmacy_records');
    return handleSchemaMigration(saved);
  });
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('pharmacy_settings');
    const parsed = saved ? JSON.parse(saved) : {};
    return {
      pharmacyName: parsed.pharmacyName || 'AsquafMedical',
      reminderTime: parsed.reminderTime || '09:00',
      language: parsed.language || 'en',
      googleSheetsId: parsed.googleSheetsId || '',
      googleSheetsAutoSync: parsed.googleSheetsAutoSync ?? false,
      googleSheetsUrl: parsed.googleSheetsUrl || ''
    };
  });
  const [isAdding, setIsAdding] = useState(false);
  const [paymentRecord, setPaymentRecord] = useState<SupplierRecord | null>(null);
  const [notifiedRecords, setNotifiedRecords] = useState<string[]>([]);
  
  // Google Sheets integration state
  const [user, setUser] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isGuest, setIsGuestState] = useState<boolean>(() => localStorage.getItem('is_guest_mode') === 'true');

  const setIsGuest = (val: boolean) => {
    setIsGuestState(val);
    localStorage.setItem('is_guest_mode', val ? 'true' : 'false');
  };

  const t = TRANSLATIONS[settings.language];
  const isUrdu = settings.language === 'ur';

  // Persistence (local offline fallback)
  useEffect(() => {
    localStorage.setItem('pharmacy_records', JSON.stringify(records));
  }, [records]);

  // Google Auth lifecycle
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, token) => {
        setUser(currentUser);
        setAccessToken(token);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setAuthLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Sync settings & records from Cloud on User Authentication
  useEffect(() => {
    const loadCloudData = async () => {
      if (user) {
        setAuthLoading(true);
        try {
          // 1. Fetch user custom pharmacy settings
          const dbSettings = await loadSettingsFromFirebase(user.uid);
          if (dbSettings) {
            setSettings(dbSettings);
            localStorage.setItem('pharmacy_settings', JSON.stringify(dbSettings));
          } else {
            // First login: sync client profile config to cloud
            await saveSettingsToFirebase(user.uid, settings);
          }

          // 2. Fetch ledger records
          const dbRecords = await loadRecordsFromFirebase(user.uid);
          if (dbRecords && dbRecords.length > 0) {
            const migrated = migrateRecords(dbRecords);
            setRecords(migrated);
            localStorage.setItem('pharmacy_records', JSON.stringify(migrated));
          } else if (records.length > 0) {
            // Cloud is empty but has local cache records: push them to cloud
            for (const r of records) {
              await saveRecordToFirebase(user.uid, r);
            }
          }
        } catch (e) {
          console.error("Firebase cloud hydration error:", e);
        } finally {
          setAuthLoading(false);
        }
      } else {
        setAuthLoading(false);
      }
    };
    loadCloudData();
  }, [user]);

  // React on local settings modification to sync Firestore
  useEffect(() => {
    localStorage.setItem('pharmacy_settings', JSON.stringify(settings));
    if (user) {
      saveSettingsToFirebase(user.uid, settings).catch(err => {
        console.error("Failed to save settings modifications to cloud:", err);
      });
    }
  }, [settings, user]);

  // Google Sheets Auto-Sync effect
  useEffect(() => {
    if (settings.googleSheetsAutoSync && accessToken && settings.googleSheetsId && records.length > 0) {
      const timer = setTimeout(() => {
        syncToSpreadsheet(accessToken, settings.googleSheetsId!, records).catch(err => {
          console.error("Auto-sync failed:", err);
        });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [records, settings.googleSheetsAutoSync, settings.googleSheetsId, accessToken]);

  const handleSheetsSync = async (targetToken?: string, targetId?: string) => {
    const token = targetToken || accessToken;
    const sheetId = targetId || settings.googleSheetsId;

    if (!token) {
      alert(isUrdu ? 'پہلے گوگل لاگ ان کریں' : 'Please sign in with Google first');
      return;
    }
    if (!sheetId) {
      alert(isUrdu ? 'پہلے اسپریڈ شیٹ بنائیں یا لنک کریں' : 'Please create or link a spreadsheet first');
      return;
    }

    setIsSyncing(true);
    try {
      await syncToSpreadsheet(token, sheetId, records);
      alert(t.syncCompleted);
    } catch (err: any) {
      console.error(err);
      alert(isUrdu ? 'سنک کرنے میں خرابی پیش آگئی' : `Failed to sync: ${err.message || err}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Notifications logic
  useEffect(() => {
    if (!("Notification" in window)) return;
    
    Notification.requestPermission();

    const checkDueDates = () => {
      const today = new Date();
      records.forEach(record => {
        const alreadyNotified = notifiedRecords.includes(record.id);
        let isDueTime = false;
        let notificationBody = '';
        let isSettled = false;

        if (record.type === 'supplier') {
          const calcs = getSupplierDueCalculations(record as SupplierRecord, today);
          isSettled = calcs.status === 'settled';
          if (!isSettled) {
            const dueDate = parseISO(record.dueDate);
            const oneDayBefore = addDays(dueDate, -1);
            if (isToday(dueDate)) {
              isDueTime = true;
              notificationBody = isUrdu 
                ? `⚠️ ${record.supplierName} — Rs. ${calcs.remaining.toLocaleString()} باقی، آج واجب الادا ہے۔`
                : `⚠️ ${record.supplierName} — Rs. ${calcs.remaining.toLocaleString()} baqi, due today.`;
            } else if (isToday(oneDayBefore)) {
              isDueTime = true;
              notificationBody = isUrdu 
                ? `⚠️ ${record.supplierName} — Rs. ${calcs.remaining.toLocaleString()} باقی، کل واجب الادا ہے۔`
                : `⚠️ ${record.supplierName} — Rs. ${calcs.remaining.toLocaleString()} baqi, due tomorrow.`;
            }
          }
        } else {
          isSettled = record.status === 'paid';
          if (!isSettled) {
            const dueDate = parseISO(record.dueDate);
            if (isToday(dueDate)) {
              isDueTime = true;
              notificationBody = `${isUrdu ? 'آج واجب الادا' : 'Due today'}: ${(record as CustomerRecord).customerName} - Rs. ${record.amount.toLocaleString()}`;
            }
          }
        }

        if (isDueTime && !isSettled && !alreadyNotified) {
          new Notification(settings.pharmacyName, {
            body: notificationBody,
            icon: '/favicon.ico'
          });
          setNotifiedRecords(prev => [...prev, record.id]);
        }
      });
    };

    const interval = setInterval(checkDueDates, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [records, settings, notifiedRecords, isUrdu]);

  // Actions
  const addRecord = async (newRecord: Omit<AppRecord, 'id' | 'status'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    const dueDate = parseISO(newRecord.dueDate);
    let status: AppRecord['status'] = 'pending';
    
    if (isToday(dueDate)) status = 'due-today';
    else if (isPast(dueDate)) status = 'overdue';

    const fullRecord = { 
      ...newRecord, 
      id, 
      status,
      ...(newRecord.type === 'supplier' ? { payments: [] } : {})
    } as AppRecord;

    setRecords(prev => [fullRecord, ...prev]);
    setIsAdding(false);

    if (user) {
      try {
        await saveRecordToFirebase(user.uid, fullRecord);
      } catch (err) {
        console.error("Failed to add record to Firestore:", err);
      }
    }
  };

  const markAsPaid = (id: string) => {
    setRecords(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, status: 'paid' as const } : r);
      const target = updated.find(r => r.id === id);
      if (target && user) {
        saveRecordToFirebase(user.uid, target).catch(err => {
          console.error("Failed to update status on Firestore:", err);
        });
      }
      return updated;
    });
  };

  const markCustomerPaid = async (customerName: string, phoneNumber: string) => {
    const unpaidRecords = records.filter(r => 
      r.type === 'customer' && 
      r.customerName === customerName && 
      r.phoneNumber === phoneNumber && 
      r.status !== 'paid'
    ) as CustomerRecord[];

    const totalAmount = unpaidRecords.reduce((sum, r) => sum + r.amount, 0);

    const confirmMsg = isUrdu
      ? `کیا آپ واقعی اس گاہک (${customerName}) کی کل وصولی Rs. ${totalAmount.toLocaleString()} کو کلیئر کرنا چاہتے ہیں؟`
      : `Are you sure you want to clear the total outstanding amount of Rs. ${totalAmount.toLocaleString()} for ${customerName}?`;

    if (confirm(confirmMsg)) {
      setRecords(prev => {
        const updated = prev.map(r => {
          if (r.type === 'customer' && r.customerName === customerName && r.phoneNumber === phoneNumber && r.status !== 'paid') {
            return { ...r, status: 'paid' as const };
          }
          return r;
        });

        // Sync to Firestore
        if (user) {
          unpaidRecords.forEach(r => {
            const updatedRecord = { ...r, status: 'paid' as const };
            saveRecordToFirebase(user.uid, updatedRecord).catch(err => {
              console.error("Failed to sync paid record to Firestore:", err);
            });
          });
        }

        return updated;
      });
    }
  };

  const deleteCustomerGroup = async (customerName: string, phoneNumber: string) => {
    const confirmMsg = isUrdu 
      ? `کیا آپ واقعی اس گاہک (${customerName}) کے تمام بقایا ریکارڈز کو حذف کرنا چاہتے ہیں؟`
      : `Are you sure you want to delete all outstanding records for customer ${customerName}?`;
    
    if (confirm(confirmMsg)) {
      const toDelete = records.filter(r => r.type === 'customer' && r.customerName === customerName && r.phoneNumber === phoneNumber);
      
      setRecords(prev => prev.filter(r => !(r.type === 'customer' && r.customerName === customerName && r.phoneNumber === phoneNumber)));
      
      if (user) {
        for (const r of toDelete) {
          try {
            await deleteRecordFromFirebase(user.uid, r.id);
          } catch (err) {
            console.error("Failed to delete record from Firestore:", err);
          }
        }
      }
    }
  };

  const recordPayment = (recordId: string, payment: { amount: number; date: string; method: string; note?: string }) => {
    setRecords(prev => {
      const updated = prev.map(r => {
        if (r.id === recordId && r.type === 'supplier') {
          const supplier = r as SupplierRecord;
          const newPayment = {
            ...payment,
            id: 'pay_' + Math.random().toString(36).substr(2, 9),
            createdAt: new Date().toISOString()
          };
          const currentPayments = supplier.payments || [];
          const updatedPayments = [...currentPayments, newPayment];
          
          const tempSupplier = { ...supplier, payments: updatedPayments };
          const calcs = getSupplierDueCalculations(tempSupplier, new Date());
          
          return {
            ...supplier,
            payments: updatedPayments,
            status: calcs.status === 'settled' ? 'paid' : 'pending'
          } as AppRecord;
        }
        return r;
      });

      const target = updated.find(r => r.id === recordId);
      if (target && user) {
        saveRecordToFirebase(user.uid, target).catch(err => {
          console.error("Failed to save payment to Firestore:", err);
        });
      }
      return updated;
    });
  };

  const reversePayment = (recordId: string, paymentId: string) => {
    if (!confirm(isUrdu ? 'کیا آپ واقعی اس ادائیگی کو منسوخ کرنا چاہتے ہیں؟' : 'Are you sure you want to reverse this payment?')) return;
    setRecords(prev => {
      const updated = prev.map(r => {
        if (r.id === recordId && r.type === 'supplier') {
          const supplier = r as SupplierRecord;
          const currentPayments = supplier.payments || [];
          const targetPayment = currentPayments.find(p => p.id === paymentId);
          if (!targetPayment) return r;

          const reversal = {
            id: 'rev_' + Math.random().toString(36).substr(2, 9),
            amount: targetPayment.amount,
            date: format(new Date(), 'yyyy-MM-dd'),
            method: targetPayment.method,
            note: isUrdu ? 'منسوخ شدہ ادائیگی' : `Reversed payment`,
            reversesPaymentId: targetPayment.id,
            createdAt: new Date().toISOString()
          };

          const updatedPayments = [...currentPayments, reversal];
          const tempSupplier = { ...supplier, payments: updatedPayments };
          const calcs = getSupplierDueCalculations(tempSupplier, new Date());

          return {
            ...supplier,
            payments: updatedPayments,
            status: calcs.status === 'settled' ? 'paid' : 'pending'
          } as AppRecord;
        }
        return r;
      });

      const target = updated.find(r => r.id === recordId);
      if (target && user) {
        saveRecordToFirebase(user.uid, target).catch(err => {
          console.error("Failed to save reversal to Firestore:", err);
        });
      }
      return updated;
    });
  };

  const deleteRecord = async (id: string) => {
    if (confirm('Delete this record?')) {
      setRecords(prev => prev.filter(r => r.id !== id));
      if (user) {
        try {
          await deleteRecordFromFirebase(user.uid, id);
        } catch (err) {
          console.error("Failed to delete record from Firestore:", err);
        }
      }
    }
  };

  const toggleLanguage = () => {
    setSettings(prev => ({ ...prev, language: prev.language === 'en' ? 'ur' : 'en' }));
  };

  // Group customers by name and phone to show "current due" instead of thread history
  const groupedCustomers = useMemo(() => {
    if (activeTab !== 'customers') return [];
    const customerRecords = records.filter(r => r.type === 'customer' && r.status !== 'paid') as CustomerRecord[];
    
    const groups: { [key: string]: CustomerRecord[] } = {};
    customerRecords.forEach(r => {
      const key = `${r.customerName.trim().toLowerCase()}_${r.phoneNumber.trim()}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(r);
    });
    
    return Object.values(groups).map(groupRecords => {
      const sorted = [...groupRecords].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const totalAmount = sorted.reduce((sum, r) => sum + r.amount, 0);
      const earliestDue = [...groupRecords].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0]?.dueDate;
      const primaryRecord = sorted[0];
      
      return {
        id: `group_${primaryRecord.id}`,
        customerName: primaryRecord.customerName,
        phoneNumber: primaryRecord.phoneNumber,
        totalAmount,
        records: sorted,
        earliestDueDate: earliestDue,
        latestDate: primaryRecord.date
      };
    }).sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
  }, [records, activeTab]);

  // View records filter
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (activeTab === 'suppliers') {
        const isSupplier = r.type === 'supplier';
        if (isSupplier) {
          const calcs = getSupplierDueCalculations(r as SupplierRecord, new Date());
          return calcs.status !== 'settled';
        }
        return false;
      }
      return false;
    });
  }, [records, activeTab]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0b141a] text-[#e9edef] flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm text-[#8696a0]">Loading AsquafMedical...</p>
        </div>
      </div>
    );
  }

  if (!user && !isGuest) {
    return (
      <div className="min-h-screen bg-[#0b141a] text-[#e9edef] flex flex-col justify-between p-6 font-sans select-none" dir={isUrdu ? 'rtl' : 'ltr'}>
        <div className="flex justify-end">
          <button 
            type="button"
            onClick={toggleLanguage}
            className="bg-[#202c33] hover:bg-[#2a3942] text-xs font-bold text-[#00a884] px-4 py-2 rounded-full border border-white/5 transition-all"
          >
            {isUrdu ? 'English' : 'اردو'}
          </button>
        </div>
        
        <div className="flex-1 flex items-center justify-center py-8">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-[#202c33] p-8 rounded-3xl border border-white/5 shadow-2xl text-center space-y-6"
          >
            <div className="w-20 h-20 bg-[#00a884]/10 rounded-full mx-auto flex items-center justify-center text-[#00a884] border border-[#00a884]/20 animate-pulse">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            
            <div className="space-y-4">
              <h1 className="text-3xl font-extrabold tracking-tight text-white font-sans">AsquafMedical</h1>
              <p className="text-[#8696a0] text-sm leading-relaxed">
                {isUrdu 
                  ? 'فارمیسیوں کے لیے ایک محفوظ، پریمیم واٹس ایپ طرز کا کریڈٹ اور ادویات کا ریکارڈ ٹریکر۔' 
                  : 'A secure, premium WhatsApp-styled credit and medicine ledger for pharmacies.'}
              </p>
            </div>

            {/* Iframe detection / browser security helper */}
            <div className="bg-[#53bdeb]/10 border border-[#53bdeb]/20 p-4 rounded-2xl text-left text-xs text-[#53bdeb] space-y-2">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="leading-relaxed">
                  {isUrdu 
                    ? 'نوٹ: اگر فریم (Iframe) سیکیورٹی کی وجہ سے گوگل لاگ ان بلاک ہو، تو نیچے آف لائن موڈ استعمال کریں یا ایپ نئے ٹیب میں کھولیں۔' 
                    : 'Note: If Google login fails inside this preview iframe due to browser security, please use Offline Mode below or open the app in a new tab.'}
                </p>
              </div>
              <a 
                href={window.location.href} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-block bg-[#53bdeb]/20 hover:bg-[#53bdeb]/35 px-3 py-1.5 rounded-xl font-bold transition-all text-[10px] uppercase border border-[#53bdeb]/30 text-[#e9edef] cursor-pointer"
              >
                {isUrdu ? 'نئے ٹیب میں کھولیں' : 'Open in New Tab'}
              </a>
            </div>

            <div className="space-y-3 pt-2">
              <button 
                type="button"
                onClick={async () => {
                  try {
                    await googleSignIn();
                  } catch (err: any) {
                    console.error("Popup login error:", err);
                    alert(isUrdu 
                      ? 'لاگ ان کرنے میں خرابی پیش آگئی۔ براہ کرم نیچے آف لائن موڈ آزمائیں یا اوپر دیے گئے بٹن سے نئے ٹیب میں کھولیں۔' 
                      : `Failed to login: ${err.message || err}. Please try Offline Mode or open the app in a new tab.`);
                  }
                }}
                className="w-full bg-[#00a884] hover:bg-[#00c99a] text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all hover:shadow-[0_8px_20px_rgba(0,168,132,0.3)] active:scale-[0.98] cursor-pointer"
              >
                <LogIn size={20} />
                <span>{isUrdu ? 'گوگل اکاؤنٹ سے لاگ ان کریں' : 'Sign in with Google'}</span>
              </button>

              <button 
                type="button"
                onClick={() => setIsGuest(true)}
                className="w-full bg-[#2a3942] hover:bg-[#3b4a54] text-[#00a884] py-3.5 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all border border-white/5 active:scale-[0.98] cursor-pointer text-xs"
              >
                <span>{isUrdu ? 'لاگ ان کے بغیر جاری رکھیں (آف لائن موڈ)' : 'Continue to Dashboard (Offline Mode)'}</span>
              </button>
            </div>

            <div className="pt-4 border-t border-white/5 flex items-center justify-center gap-2 text-xs text-[#8696a0]">
              <svg className="w-4 h-4 text-[#00a884]" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              <span>{isUrdu ? 'کلاؤڈ سیکیور ڈیٹا بیس' : 'Cloud Secure Data Storage'}</span>
            </div>
          </motion.div>
        </div>

        <div className="text-center text-[10px] text-[#8696a0]/50 font-mono">
          &copy; {new Date().getFullYear()} AsquafMedical. Secured via Firebase.
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "min-h-screen bg-[#0b141a] text-[#e9edef] flex flex-col font-sans",
      isUrdu && "rtl font-medium"
    )} dir={isUrdu ? 'rtl' : 'ltr'}>
      
      {/* Header */}
      <header className="bg-[#202c33] text-[#e9edef] px-4 py-3 shadow-md flex items-center justify-between sticky top-0 z-50 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#00a884] rounded-full flex items-center justify-center text-white">
            <Store size={22} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">{settings.pharmacyName}</h1>
            <p className="text-[10px] text-[#8696a0] font-medium uppercase tracking-wider">{t.appName}</p>
          </div>
        </div>
        <button 
          onClick={toggleLanguage}
          className="flex items-center gap-2 bg-[#2a3942] px-3 py-1.5 rounded-full text-xs hover:bg-[#3b4a54] transition-colors border border-white/5"
        >
          <Languages size={14} />
          <span>{settings.language === 'en' ? 'اردو' : 'English'}</span>
        </button>
      </header>

      {/* Offline/Guest Mode Banner */}
      {!user && isGuest && (
        <div className="bg-[#53bdeb]/15 text-[#53bdeb] border-b border-[#53bdeb]/20 px-4 py-3 text-xs flex items-center justify-between gap-3 font-sans" dir={isUrdu ? 'rtl' : 'ltr'}>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[#53bdeb] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="leading-normal">
              {isUrdu 
                ? 'لوکل آف لائن موڈ فعال ہے۔ کلاؤڈ سیکیور سنک استعمال کرنے کے لیے ایپ کو نئے ٹیب میں کھولیں۔' 
                : 'Offline Mode active. Open in a new tab to use Cloud Firestore sync.'}
            </p>
          </div>
          <a 
            href={window.location.href} 
            target="_blank" 
            rel="noopener noreferrer"
            className="shrink-0 bg-[#53bdeb]/20 hover:bg-[#53bdeb]/30 px-3 py-1 rounded-xl font-bold transition-all text-[10px] uppercase border border-[#53bdeb]/30 text-[#e9edef] whitespace-nowrap cursor-pointer"
          >
            {isUrdu ? 'نئے ٹیب میں کھولیں' : 'Open in New Tab'}
          </a>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto px-4 py-4 mb-20 space-y-5 scroll-smooth">
        {activeTab !== 'settings' && (
          <AnimatePresence mode="popLayout">
            {((activeTab === 'customers' && groupedCustomers.length === 0) || 
              (activeTab === 'suppliers' && filteredRecords.length === 0)) ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-24 text-[#8696a0]"
              >
                <div className="bg-[#202c33] p-8 rounded-3xl inline-block shadow-lg border border-white/5">
                  <MessageCircle size={56} className="mx-auto mb-5 text-[#00a884]/40" />
                  <p className="text-sm font-medium">{t.noRecords}</p>
                </div>
              </motion.div>
            ) : activeTab === 'customers' ? (
              groupedCustomers.map((group) => (
                <CustomerGroupBubble 
                  key={group.id} 
                  group={group} 
                  settings={settings}
                  onMarkCustomerPaid={markCustomerPaid}
                  onDeleteCustomerGroup={deleteCustomerGroup}
                />
              ))
            ) : (
              filteredRecords.map((record) => (
                <RecordBubble 
                  key={record.id} 
                  record={record} 
                  settings={settings}
                  onMarkPaid={markAsPaid}
                  onDelete={deleteRecord}
                  onRecordPayment={record.type === 'supplier' ? () => setPaymentRecord(record as SupplierRecord) : undefined}
                  onReversePayment={reversePayment}
                />
              ))
            )}
          </AnimatePresence>
        )}

        {activeTab === 'settings' && (
          <SettingsPanel 
            settings={settings} 
            setSettings={setSettings} 
            t={t} 
            records={records} 
            setRecords={setRecords}
            user={user}
            setUser={setUser}
            accessToken={accessToken}
            setAccessToken={setAccessToken}
            isSyncing={isSyncing}
            handleSheetsSync={handleSheetsSync}
            isGuest={isGuest}
            setIsGuest={setIsGuest}
          />
        )}
      </main>

      {/* Input Overlay */}
      <AnimatePresence>
        {isAdding && (
          <AddRecordModal 
            onClose={() => setIsAdding(false)} 
            onAdd={addRecord} 
            activeTab={activeTab} 
            t={t}
            isUrdu={isUrdu}
          />
        )}
        {paymentRecord && (
          <RecordPaymentModal
            record={paymentRecord}
            onClose={() => setPaymentRecord(null)}
            onRecord={(payment) => {
              recordPayment(paymentRecord.id, payment);
              setPaymentRecord(null);
            }}
            isUrdu={isUrdu}
          />
        )}
      </AnimatePresence>

      {/* Bottom Nav */}
      <nav className="bg-[#202c33] border-t border-white/5 fixed bottom-0 left-0 right-0 h-16 flex items-center justify-around z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.4)]">
        <NavButton 
          active={activeTab === 'customers'} 
          onClick={() => setActiveTab('customers')} 
          icon={<Users size={22} />} 
          label={t.customers}
        />
        <NavButton 
          active={activeTab === 'suppliers'} 
          onClick={() => setActiveTab('suppliers')} 
          icon={<Store size={22} />} 
          label={t.suppliers}
        />
        <NavButton 
          active={activeTab === 'settings'} 
          onClick={() => setActiveTab('settings')} 
          icon={<SettingsIcon size={22} />} 
          label={t.settings}
        />

        {activeTab !== 'settings' && (
          <button 
            onClick={() => setIsAdding(true)}
            className="absolute -top-10 right-6 w-16 h-16 bg-[#00a884] text-white rounded-full flex items-center justify-center shadow-[0_8px_20px_rgba(0,168,132,0.4)] hover:scale-105 active:scale-95 transition-all duration-200 z-50 ring-4 ring-[#202c33]"
          >
            <Plus size={34} />
          </button>
        )}
      </nav>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center flex-1 transition-all duration-200 relative",
        active ? "text-[#00a884]" : "text-[#8696a0]"
      )}
    >
      <motion.div
        animate={{ y: active ? -2 : 0, scale: active ? 1.1 : 1 }}
        className="mb-1"
      >
        {icon}
      </motion.div>
      <span className={cn("text-[10px] font-bold tracking-wide uppercase", active ? "opacity-100" : "opacity-60")}>
        {label}
      </span>
      {active && (
        <motion.div 
          layoutId="navTab"
          className="absolute -top-3 w-8 h-1 bg-[#00a884] rounded-full"
        />
      )}
    </button>
  );
}

interface GroupedCustomerData {
  id: string;
  customerName: string;
  phoneNumber: string;
  totalAmount: number;
  records: CustomerRecord[];
  earliestDueDate: string;
  latestDate: string;
}

function CustomerGroupBubble({
  group,
  settings,
  onMarkCustomerPaid,
  onDeleteCustomerGroup
}: {
  key?: string;
  group: GroupedCustomerData;
  settings: AppSettings;
  onMarkCustomerPaid: (name: string, phone: string) => void;
  onDeleteCustomerGroup: (name: string, phone: string) => void;
}) {
  const [showOptions, setShowOptions] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [viewFullImage, setViewFullImage] = useState<string | null>(null);
  const [viewFullImageName, setViewFullImageName] = useState<string>('');
  
  const t = TRANSLATIONS[settings.language];
  const isUrdu = settings.language === 'ur';

  const getGroupDaysInfo = () => {
    const today = new Date();
    const dueDate = parseISO(group.earliestDueDate);
    const diff = differenceInDays(dueDate, today);
    
    if (diff === 0) return t.dueToday;
    if (diff < 0) return `${Math.abs(diff)} ${t.daysOverdue}`;
    return `${diff} ${t.daysLeft}`;
  };

  const getGroupStatusColor = () => {
    const dueDate = parseISO(group.earliestDueDate);
    if (isToday(dueDate)) return 'bg-[#5c4b00] text-[#fecb00] border-white/10';
    if (isPast(dueDate)) return 'bg-[#4b1c1c] text-[#ff6a6a] border-white/10';
    return 'bg-[#005c4b]/50 text-[#00a884] border-white/10';
  };

  const handleCall = () => {
    if (group.phoneNumber) {
      window.location.href = `tel:${group.phoneNumber}`;
    }
  };

  const handleWhatsApp = () => {
    const msg = t.whatsappTemplate(group.customerName, settings.pharmacyName, group.totalAmount);
    window.open(`https://wa.me/${group.phoneNumber.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="max-w-[88%] ml-auto p-3.5 rounded-2xl rounded-tr-none bg-[#005c4b] shadow-md border border-white/5 relative group"
    >
      <div className="flex justify-between items-start mb-2 gap-4">
        <div>
          <h3 className="font-bold text-sm text-[#e9edef]">
            {group.customerName}
          </h3>
          <p className="text-[10px] text-[#8696a0] font-mono mt-0.5 tracking-tight">{group.phoneNumber}</p>
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right">
            <p className="font-bold text-base text-[#e9edef]">
              Rs. {group.totalAmount.toLocaleString()}
            </p>
            <p className="text-[9px] text-[#8696a0] font-bold uppercase tracking-wide">
              {isUrdu ? 'کل ادھار' : 'Current Due'}
            </p>
          </div>
          <div className="relative">
            <button 
              onClick={() => setShowOptions(!showOptions)}
              className="p-1 text-[#8696a0] hover:text-[#e9edef] transition-colors cursor-pointer"
            >
              <MoreVertical size={18} />
            </button>
            <AnimatePresence>
              {showOptions && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowOptions(false)} />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -10 }}
                    className="absolute right-0 top-full mt-1 bg-[#2a3942] border border-white/10 rounded-xl py-1 shadow-xl z-20 min-w-[120px]"
                  >
                    <button 
                      onClick={() => { onDeleteCustomerGroup(group.customerName, group.phoneNumber); setShowOptions(false); }}
                      className="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                    >
                      <Trash2 size={14} />
                      {settings.language === 'ur' ? 'حذف کریں' : 'Delete'}
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="text-[10px] text-[#8696a0] mb-3 flex items-center gap-1.5 font-medium">
        <span>{isUrdu ? 'آخری تاریخ:' : 'Latest:'} <strong className="text-[#e9edef] font-semibold">{format(parseISO(group.latestDate), 'd MMM')}</strong></span>
        <span className="opacity-40">·</span>
        <span className={cn("px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider", getGroupStatusColor())}>
          {getGroupDaysInfo()}
        </span>
      </div>

      {/* Collapsible breakdown of individual bills */}
      <div className="mb-3">
        <button 
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-between text-[10px] text-[#e9edef]/80 hover:text-white font-bold py-2 px-3 bg-black/15 hover:bg-black/25 rounded-xl border border-white/5 transition-all cursor-pointer"
        >
          <span>
            {isUrdu 
              ? `${group.records.length} بلز کی تفصیل`
              : `${group.records.length} Bills Details`}
          </span>
          {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        
        <AnimatePresence>
          {showDetails && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-2 mt-2 bg-black/20 p-2.5 rounded-2xl border border-white/5"
            >
              {group.records.map((r, idx) => {
                const rDueDate = parseISO(r.dueDate);
                const rOverdue = isPast(rDueDate) && !isToday(rDueDate);
                return (
                  <div key={r.id || idx} className="text-[11px] border-b border-white/5 last:border-0 pb-2 last:pb-0">
                    <div className="flex justify-between items-start gap-2">
                      <div className="font-semibold text-white truncate max-w-[65%]">
                        {r.description || (isUrdu ? 'ادھار دوا' : 'Medicine Credit')}
                      </div>
                      <div className="text-[#00a884] font-extrabold font-mono whitespace-nowrap">
                        Rs. {r.amount.toLocaleString()}
                      </div>
                    </div>
                    <div className="flex justify-between text-[9px] text-[#8696a0] mt-1">
                      <span>{isUrdu ? 'تاریخ:' : 'Date:'} {format(parseISO(r.date), 'd MMM yyyy')}</span>
                      <span className={cn(rOverdue && "text-red-400 font-bold")}>
                        {isUrdu ? 'واپسی:' : 'Due:'} {format(parseISO(r.dueDate), 'd MMM yyyy')}
                      </span>
                    </div>
                    {r.attachmentUrl && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 bg-black/15 p-1.5 rounded-xl border border-white/5">
                        <span className="text-[9px] text-[#8696a0] truncate font-mono max-w-[60%]">{r.attachmentName || 'receipt.jpg'}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setViewFullImage(r.attachmentUrl!);
                            setViewFullImageName(r.attachmentName || 'receipt.jpg');
                          }}
                          className="text-[9px] text-[#00a884] font-bold hover:underline cursor-pointer"
                        >
                          {t.viewAttachment}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between mt-1 pt-2.5 border-t border-white/5">
        <div className="flex gap-2">
          <button 
            onClick={handleCall}
            className="w-9 h-9 rounded-full bg-[#2a3942] flex items-center justify-center text-[#e9edef] hover:bg-[#3b4a54] transition-colors border border-white/5 active:scale-90 cursor-pointer"
            title={isUrdu ? 'کال کریں' : 'Call'}
          >
            <Phone size={14} />
          </button>
          <button 
            onClick={handleWhatsApp}
            className="w-9 h-9 rounded-full bg-[#2a3942] flex items-center justify-center text-[#00a884] hover:bg-[#3b4a54] transition-colors border border-white/5 active:scale-90 cursor-pointer"
            title={isUrdu ? 'واٹس ایپ' : 'WhatsApp'}
          >
            <MessageCircle size={14} />
          </button>
        </div>
        
        <button 
          onClick={() => onMarkCustomerPaid(group.customerName, group.phoneNumber)}
          className="flex items-center gap-1.5 bg-[#00a884] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md hover:bg-[#00c99a] active:scale-95 transition-all cursor-pointer"
        >
          <CheckCircle2 size={13} />
          {t.markPaid}
        </button>
      </div>

      <span className="absolute bottom-1 right-2.5 text-[8px] text-[#8696a0] font-mono opacity-40">
        {format(new Date(), 'HH:mm')}
      </span>

      {/* Lightbox Modal */}
      <AnimatePresence>
        {viewFullImage && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="max-w-3xl w-full max-h-[85vh] flex items-center justify-center relative rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-[#111b21]"
            >
              <img 
                src={viewFullImage} 
                alt={viewFullImageName} 
                className="max-w-full max-h-[80vh] object-contain"
                referrerPolicy="no-referrer"
              />
              <button 
                type="button"
                onClick={() => setViewFullImage(null)}
                className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 transition-colors border border-white/10 active:scale-90 cursor-pointer"
              >
                <X size={20} />
              </button>
            </motion.div>
            <p className="mt-4 text-xs font-mono text-[#8696a0] bg-[#202c33] px-4 py-2 rounded-full border border-white/5">
              {viewFullImageName}
            </p>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function RecordBubble({ 
  record, 
  settings, 
  onMarkPaid,
  onDelete,
  onRecordPayment,
  onReversePayment
}: { 
  key?: string;
  record: AppRecord;
  settings: AppSettings;
  onMarkPaid: (id: string) => void;
  onDelete: (id: string) => void;
  onRecordPayment?: () => void;
  onReversePayment?: (recordId: string, paymentId: string) => void;
}) {
  const [showOptions, setShowOptions] = useState(false);
  const [viewFullImage, setViewFullImage] = useState(false);
  const [showPayments, setShowPayments] = useState(false);
  const t = TRANSLATIONS[settings.language];
  const isUrdu = settings.language === 'ur';

  const isSupplier = record.type === 'supplier';
  const supplierRecord = record as SupplierRecord;
  const calcs = isSupplier ? getSupplierDueCalculations(supplierRecord, new Date()) : null;

  const isPaid = isSupplier ? calcs?.status === 'settled' : record.status === 'paid';
  const displayAmount = isSupplier ? calcs?.remaining : record.amount;
  const originalAmount = isSupplier ? calcs?.originalAmount : record.amount;
  const paidAmount = isSupplier ? calcs?.paid : 0;

  const getStatusColor = () => {
    if (isPaid) return 'bg-[#111b21] text-[#8696a0] border-white/5';
    
    if (isSupplier && calcs) {
      if (calcs.status === 'due-today') return 'bg-[#5c4b00] text-[#fecb00] border-white/10';
      if (calcs.status === 'overdue') return 'bg-[#4b1c1c] text-[#ff6a6a] border-white/10';
      return 'bg-[#005c4b] text-[#00a884] border-white/10';
    }

    const dueDate = parseISO(record.dueDate);
    if (isToday(dueDate)) return 'bg-[#5c4b00] text-[#fecb00] border-white/10';
    if (isPast(dueDate)) return 'bg-[#4b1c1c] text-[#ff6a6a] border-white/10';
    return 'bg-[#005c4b] text-[#00a884] border-white/10';
  };

  const getDaysInfo = () => {
    if (isPaid) return null;
    
    if (isSupplier && calcs) {
      if (calcs.status === 'due-today') return t.dueToday;
      if (calcs.status === 'overdue') {
        const d = Math.abs(calcs.daysDiff);
        return isUrdu ? `میعاد ختم (${d} دن)` : `OVERDUE (${d} days)`;
      }
      return isUrdu ? `${calcs.daysDiff} دن باقی` : `DUE IN ${calcs.daysDiff} DAYS`;
    }

    const today = new Date();
    const dueDate = parseISO(record.dueDate);
    const diff = differenceInDays(dueDate, today);
    
    if (diff === 0) return t.dueToday;
    if (diff < 0) return `${Math.abs(diff)} ${t.daysOverdue}`;
    return `${diff} ${t.daysLeft}`;
  };

  const handleCall = () => {
    const phone = isSupplier ? supplierRecord.phoneNumber : (record as CustomerRecord).phoneNumber;
    if (phone) {
      window.location.href = `tel:${phone}`;
    }
  };

  const handleWhatsApp = () => {
    if (isSupplier) {
      const pList = supplierRecord.payments || [];
      const lastPayment = pList[pList.length - 1];
      let msg = '';
      if (lastPayment) {
        msg = isUrdu
          ? `السلام علیکم، رسید نمبر ${record.id} مورخہ ${format(parseISO(record.date), 'd MMM')} کے عوض Rs. ${lastPayment.amount.toLocaleString()} کی ادائیگی کی تصدیق کی جاتی ہے۔ بقایا رقم Rs. ${displayAmount?.toLocaleString()} ہے۔`
          : `Assalam-o-Alaikum, confirming payment of Rs. ${lastPayment.amount.toLocaleString()} against invoice ${record.id} dated ${format(parseISO(record.date), 'd MMM')}. Remaining balance is Rs. ${displayAmount?.toLocaleString()}.`;
      } else {
        msg = isUrdu
          ? `السلام علیکم، بل نمبر ${record.id} مورخہ ${format(parseISO(record.date), 'd MMM')} کے تحت Rs. ${displayAmount?.toLocaleString()} واجب الادا ہیں، برائے مہربانی چیک کریں۔`
          : `Assalam-o-Alaikum, Rs. ${displayAmount?.toLocaleString()} is outstanding against invoice ${record.id} dated ${format(parseISO(record.date), 'd MMM')}. Please check.`;
      }
      const phone = supplierRecord.phoneNumber || '';
      window.open(`https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`);
    } else {
      const msg = t.whatsappTemplate((record as CustomerRecord).customerName, settings.pharmacyName, record.amount);
      window.open(`https://wa.me/${(record as CustomerRecord).phoneNumber.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={cn(
        "max-w-[88%] p-3.5 rounded-2xl shadow-md border border-white/5 relative group",
        record.type === 'customer' ? "ml-auto bg-[#005c4b] rounded-tr-none" : "mr-auto bg-[#202c33] rounded-tl-none",
        isPaid && "opacity-60 bg-[#111b21] border-white/5"
      )}
    >
      <div className="flex justify-between items-start mb-2 gap-4">
        <div>
          <h3 className={cn("font-bold text-sm", record.type === 'customer' ? "text-[#e9edef]" : "text-[#00a884]")}>
            {record.type === 'customer' ? (record as CustomerRecord).customerName : supplierRecord.supplierName}
            {isSupplier && supplierRecord.phoneNumber && (
              <span className="text-[#8696a0] font-normal text-xs ml-1 font-mono"> · {supplierRecord.phoneNumber}</span>
            )}
          </h3>
          {record.type === 'customer' && (
            <p className="text-[10px] text-[#8696a0] font-mono mt-0.5 tracking-tight">{(record as CustomerRecord).phoneNumber}</p>
          )}
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right">
            {isSupplier && originalAmount !== displayAmount ? (
              <div className="flex flex-col">
                <span className="text-[9px] text-[#8696a0] line-through">Rs. {originalAmount?.toLocaleString()}</span>
                <span className="font-bold text-sm text-[#e9edef]">
                  Rs. <span className="text-base text-[#00a884] font-extrabold">{displayAmount?.toLocaleString()}</span> {isUrdu ? 'باقی' : 'baqi'}
                </span>
              </div>
            ) : (
              <p className="font-bold text-base text-[#e9edef]">
                Rs. {displayAmount?.toLocaleString()}
                {isSupplier && <span className="text-xs font-normal text-[#8696a0] ml-1"> {isUrdu ? 'باقی' : 'baqi'}</span>}
              </p>
            )}
          </div>
          <div className="relative">
            <button 
              onClick={() => setShowOptions(!showOptions)}
              className="p-1 text-[#8696a0] hover:text-[#e9edef] transition-colors cursor-pointer"
            >
              <MoreVertical size={18} />
            </button>
            <AnimatePresence>
              {showOptions && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowOptions(false)} />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -10 }}
                    className="absolute right-0 top-full mt-1 bg-[#2a3942] border border-white/10 rounded-xl py-1 shadow-xl z-20 min-w-[120px]"
                  >
                    <button 
                      onClick={() => { onDelete(record.id); setShowOptions(false); }}
                      className="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                    >
                      <Trash2 size={14} />
                      {settings.language === 'ur' ? 'حذف کریں' : 'Delete'}
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="text-[10px] text-[#8696a0] mb-3 flex items-center gap-1.5 font-medium">
        <span>{isUrdu ? 'لیا گیا:' : 'Taken:'} <strong className="text-[#e9edef] font-semibold">{format(parseISO(record.date), 'd MMM')}</strong></span>
        <span className="opacity-40">·</span>
        <span>{isUrdu ? 'تاریخ واپسی:' : 'Due:'} <strong className="text-[#e9edef] font-semibold">{format(parseISO(record.dueDate), 'd MMM')}</strong></span>
      </div>

      {isSupplier && (
        <div className="mb-3 bg-black/20 p-2.5 rounded-2xl border border-white/5">
          <div className="flex justify-between text-[10px] text-[#8696a0] font-semibold mb-1">
            <span>Rs. {paidAmount?.toLocaleString()} {isUrdu ? 'ادا شدہ' : 'paid'}</span>
            <span>{Math.round(originalAmount && originalAmount > 0 ? (paidAmount! / originalAmount) * 100 : 0)}%</span>
          </div>
          <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden border border-white/5">
            <div 
              className="bg-[#00a884] h-full rounded-full transition-all duration-300" 
              style={{ width: `${originalAmount && originalAmount > 0 ? (paidAmount! / originalAmount) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {record.type === 'supplier' && record.items && record.items.length > 0 ? (
        <div className="bg-black/20 rounded-2xl p-3 border border-white/5 space-y-2 mb-3">
          <div className="grid grid-cols-12 gap-1 text-[9px] uppercase font-bold text-[#8696a0] tracking-wider pb-1 border-b border-white/10">
            <span className="col-span-6">{settings.language === 'ur' ? 'دوا کا نام' : 'Medicine'}</span>
            <span className="col-span-3 text-center">{settings.language === 'ur' ? 'مقدار' : 'Qty'}</span>
            <span className="col-span-3 text-right">{settings.language === 'ur' ? 'قیمت' : 'Price'}</span>
          </div>
          <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
            {record.items.map((item, idx) => (
              <div key={item.id || idx} className="grid grid-cols-12 gap-1 text-xs text-[#d1d7db] items-center">
                <span className="col-span-6 truncate font-medium text-[#e9edef]">{item.name}</span>
                <span className="col-span-3 text-center bg-white/5 text-[#8696a0] px-1.5 py-0.5 rounded text-[10px] font-mono leading-none truncate">{item.quantity}</span>
                <span className="col-span-3 text-right text-[#00a884] font-bold font-mono">Rs. {Number(item.price).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-[#d1d7db] mb-3 leading-relaxed">{record.description}</p>
      )}

      {/* Embedded File Attachment Section */}
      {record.attachmentUrl && (
        <div className="bg-black/20 p-2.5 rounded-2xl border border-white/5 flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
            <img 
              src={record.attachmentUrl} 
              alt={record.attachmentName || 'Attachment'} 
              className="w-11 h-11 object-cover rounded-xl border border-white/10 shrink-0"
              referrerPolicy="no-referrer"
            />
            <span className="text-[10px] text-[#8696a0] truncate font-mono">{record.attachmentName || 'receipt.jpg'}</span>
          </div>
          <button 
            type="button"
            onClick={() => setViewFullImage(true)}
            className="text-[10px] text-[#00a884] font-bold hover:underline shrink-0 px-3 py-1.5 bg-[#2a3942] rounded-xl border border-white/5 active:scale-95 transition-all cursor-pointer"
          >
            {t.viewAttachment}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-[9px] mb-4">
        {record.type === 'customer' && record.quantity && (
          <div className="bg-[#00a884]/10 text-[#00a884] px-2 py-1 rounded flex items-center gap-1 border border-[#00a884]/25 font-bold">
            <span>{t.quantity}:</span>
            <span>{record.quantity}</span>
          </div>
        )}
        {getDaysInfo() && (
          <span className={cn("px-2 py-1 rounded border font-bold uppercase tracking-wider", getStatusColor())}>
            {getDaysInfo()}
          </span>
        )}
      </div>

      {isSupplier && supplierRecord.payments && supplierRecord.payments.length > 0 && (
        <div className="mb-3">
          <button 
            type="button"
            onClick={() => setShowPayments(!showPayments)}
            className="text-[10px] text-[#00a884] font-bold flex items-center gap-1 hover:underline cursor-pointer"
          >
            <span>{supplierRecord.payments.length} {isUrdu ? 'ادائیگیاں' : 'payments'}</span>
            <span>{showPayments ? '▴' : '▾'}</span>
          </button>
          <AnimatePresence>
            {showPayments && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden space-y-1.5 mt-2 bg-black/10 p-2.5 rounded-2xl border border-white/5 text-[11px]"
              >
                {(() => {
                  const reversedIds = new Set<string>();
                  supplierRecord.payments.forEach(p => {
                    if (p.reversesPaymentId) {
                      reversedIds.add(p.reversesPaymentId);
                    }
                  });

                  return supplierRecord.payments.map((p) => {
                    const isReversed = reversedIds.has(p.id);
                    const isReversal = !!p.reversesPaymentId;

                    return (
                      <div 
                        key={p.id} 
                        className={cn(
                          "flex justify-between items-center text-[#d1d7db] py-1 border-b border-white/5 last:border-0",
                          isReversed && "line-through text-[#8696a0]/50"
                        )}
                      >
                        <div>
                          <span className="font-bold">Rs. {p.amount.toLocaleString()}</span>
                          <span className="text-[9px] text-[#8696a0] ml-1.5 font-mono">({p.method || 'Cash'})</span>
                          {p.note && <span className="text-[9px] text-[#8696a0] ml-1.5 italic">({p.note})</span>}
                          {isReversed && (
                            <span className="text-[8px] uppercase font-bold text-red-500 ml-1 bg-red-500/10 px-1 py-0.5 rounded border border-red-500/25 inline-block leading-none">
                              {isUrdu ? 'منسوخ شدہ' : 'reversed'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[9px] text-[#8696a0] font-mono">{format(parseISO(p.date), 'dd MMM yyyy')}</span>
                          {!isReversed && !isReversal && onReversePayment && calcs && calcs.status !== 'settled' && (
                            <button 
                              type="button"
                              onClick={() => onReversePayment(record.id, p.id)}
                              className="text-[9px] text-red-400 hover:text-red-300 font-bold px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 rounded cursor-pointer active:scale-90 transition-all leading-none"
                            >
                              {isUrdu ? 'منسوخ' : 'Reverse'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="flex items-center justify-between mt-1 pt-2.5 border-t border-white/5">
        <div className="flex gap-2">
          {(!isPaid || isSupplier) && (
            <>
              <button 
                onClick={handleCall}
                className="w-9 h-9 rounded-full bg-[#2a3942] flex items-center justify-center text-[#e9edef] hover:bg-[#3b4a54] transition-colors border border-white/5 active:scale-90 cursor-pointer"
                title={isUrdu ? 'کال کریں' : 'Call'}
              >
                <Phone size={14} />
               </button>
              <button 
                onClick={handleWhatsApp}
                className="w-9 h-9 rounded-full bg-[#2a3942] flex items-center justify-center text-[#00a884] hover:bg-[#3b4a54] transition-colors border border-white/5 active:scale-90 cursor-pointer"
                title={isUrdu ? 'واٹس ایپ' : 'WhatsApp'}
              >
                <MessageCircle size={14} />
              </button>
            </>
          )}
        </div>
        
        {isSupplier ? (
          !isPaid ? (
            <button 
              onClick={onRecordPayment}
              className="flex items-center gap-1.5 bg-[#00a884] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md hover:bg-[#00c99a] active:scale-95 transition-all cursor-pointer"
            >
              <CheckCircle2 size={13} />
              {isUrdu ? 'ادائیگی درج کریں' : 'Record payment'}
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-[#00a884] font-bold text-[10px] uppercase tracking-widest italic bg-[#00a884]/10 px-3 py-1 rounded-full border border-[#00a884]/20">
              <CheckCircle2 size={13} />
              {isUrdu ? 'بےباق' : 'SETTLED'}
            </div>
          )
        ) : (
          !isPaid ? (
            <button 
              onClick={() => onMarkPaid(record.id)}
              className="flex items-center gap-1.5 bg-[#00a884] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md hover:bg-[#00c99a] active:scale-95 transition-all cursor-pointer"
            >
              <CheckCircle2 size={13} />
              {t.markPaid}
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-[#00a884] font-bold text-[10px] uppercase tracking-widest italic bg-[#00a884]/10 px-3 py-1 rounded-full border border-[#00a884]/20">
              <CheckCircle2 size={13} />
              {t.cleared}
            </div>
          )
        )}
      </div>

      <span className="absolute bottom-1 right-2.5 text-[8px] text-[#8696a0] font-mono opacity-40">
        {format(new Date(), 'HH:mm')}
      </span>

      {/* Dynamic Fullscreen Lightbox Dialog */}
      <AnimatePresence>
        {viewFullImage && record.attachmentUrl && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="max-w-3xl w-full max-h-[85vh] flex items-center justify-center relative rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-[#111b21]"
            >
              <img 
                src={record.attachmentUrl} 
                alt={record.attachmentName || 'Full preview'} 
                className="max-w-full max-h-[80vh] object-contain"
                referrerPolicy="no-referrer"
              />
              <button 
                type="button"
                onClick={() => setViewFullImage(false)}
                className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 transition-colors border border-white/10 active:scale-90 cursor-pointer"
              >
                <X size={20} />
              </button>
            </motion.div>
            <p className="mt-4 text-xs font-mono text-[#8696a0] bg-[#202c33] px-4 py-2 rounded-full border border-white/5">
              {record.attachmentName || 'receipt.jpg'}
            </p>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AddRecordModal({ 
  onClose, 
  onAdd, 
  activeTab, 
  t,
  isUrdu
}: { 
  onClose: () => void, 
  onAdd: (r: any) => void, 
  activeTab: string, 
  t: any,
  isUrdu: boolean
}) {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    desc: '',
    amount: '',
    dueDate: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
    date: format(new Date(), 'yyyy-MM-dd')
  });

  const [items, setItems] = useState<{ id: string; name: string; quantity: string; price: string }[]>(() => [
    { id: Math.random().toString(36).substr(2, 5), name: '', quantity: '', price: '' }
  ]);

  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleAddItemRow = () => {
    setItems(prev => [...prev, { id: Math.random().toString(36).substr(2, 5), name: '', quantity: '', price: '' }]);
  };

  const handleDeleteItemRow = (itemId: string) => {
    setItems(prev => prev.filter(item => item.id !== itemId));
  };

  const handleUpdateItemField = (itemId: string, field: 'name' | 'quantity' | 'price', value: string) => {
    setItems(prev => prev.map(item => item.id === itemId ? { ...item, [field]: value } : item));
  };

  const handleFile = (file: File) => {
    if (file.size > 800 * 1024) {
      alert(isUrdu ? 'فائل کا سائز 800KB سے کم ہونا چاہیے' : 'File size must be under 800KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachment({
        url: reader.result as string,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  };

  const computedTotalAmount = useMemo(() => {
    if (activeTab !== 'suppliers') return Number(formData.amount) || 0;
    return items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  }, [items, formData.amount, activeTab]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    let finalAmount = computedTotalAmount;
    let finalDesc = formData.desc;
    let savedItems = undefined;

    if (activeTab === 'suppliers') {
      const validItems = items.filter(item => item.name.trim() !== '');
      if (validItems.length === 0) {
        alert(isUrdu ? 'برائے مہربانی کم از کم ایک دوا کا نام درج کریں' : 'Please enter at least one medicine and price');
        return;
      }
      finalAmount = validItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
      finalDesc = validItems.map(item => `${item.name.trim()} (${item.quantity.trim() || '1'})`).join(', ');
      savedItems = validItems.map(item => ({
        id: item.id,
        name: item.name.trim(),
        quantity: item.quantity.trim() || '1',
        price: Number(item.price) || 0
      }));
    } else {
      if (!finalAmount) {
        alert(isUrdu ? 'براہ کرم رقم درج کریں' : 'Please enter amount');
        return;
      }
    }

    onAdd({
      type: activeTab === 'customers' ? 'customer' : 'supplier',
      customerName: activeTab === 'customers' ? formData.name : undefined,
      supplierName: activeTab === 'suppliers' ? formData.name : undefined,
      phoneNumber: formData.phone,
      description: finalDesc,
      amount: finalAmount,
      date: formData.date,
      dueDate: formData.dueDate,
      items: savedItems,
      attachmentUrl: attachment?.url || undefined,
      attachmentName: attachment?.name || undefined
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div 
         initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="bg-[#202c33] w-full max-w-lg rounded-t-3xl sm:rounded-3xl pb-10 sm:pb-6 overflow-hidden border-t sm:border border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
      >
        <div className="bg-[#2a3942] p-5 text-[#e9edef] flex justify-between items-center border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#00a884]/20 rounded-xl flex items-center justify-center text-[#00a884]">
              {activeTab === 'customers' ? <Users size={20} /> : <Store size={20} />}
            </div>
            <div>
              <h2 className="font-bold text-base leading-tight">{t.addRecord}</h2>
              <p className="text-[10px] text-[#8696a0] font-bold uppercase tracking-wider">{activeTab === 'customers' ? t.customers : t.suppliers}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-2 px-1">{activeTab === 'customers' ? t.customerName : t.supplierName}</label>
              <input 
                autoFocus
                required
                className="w-full bg-[#2a3942] border border-white/5 rounded-2xl px-5 py-4 text-[#e9edef] text-lg outline-none focus:border-[#00a884] focus:ring-2 focus:ring-[#00a884]/20 transition-all placeholder:text-[#8696a0]/30"
                placeholder="..."
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {activeTab === 'customers' && (
              <div>
                <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-2 px-1">{t.phoneNumber}</label>
                <input 
                  type="tel"
                  className="w-full bg-[#2a3942] border border-white/5 rounded-2xl px-5 py-4 text-[#e9edef] text-lg outline-none focus:border-[#00a884] transition-all placeholder:text-[#8696a0]/30"
                  placeholder="03xx xxxxxxx"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            )}

            {activeTab === 'customers' && (
              <div>
                <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-2 px-1">{t.medicineDesc}</label>
                <textarea 
                  className="w-full bg-[#2a3942] border border-white/5 rounded-2xl px-5 py-3 text-[#e9edef] outline-none focus:border-[#00a884] transition-all placeholder:text-[#8696a0]/30 resize-none"
                  rows={2}
                  placeholder="..."
                  value={formData.desc}
                  onChange={e => setFormData({ ...formData, desc: e.target.value })}
                />
              </div>
            )}

            {activeTab === 'suppliers' && (
              <div className="space-y-3 bg-black/20 p-4 rounded-3xl border border-white/5">
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block px-1">
                    {isUrdu ? 'ادویات اور مقدار کی تفصیل' : 'Medicines & Quantities'}
                  </label>
                  <span className="text-[10px] font-mono font-bold text-[#00a884] uppercase tracking-wider">
                    {isUrdu ? `کل اشیاء: ${items.length}` : `Items: ${items.length}`}
                  </span>
                </div>

                <div className="space-y-3 max-h-[180px] overflow-y-auto pr-1">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 bg-[#2a3942]/60 p-2.5 rounded-2xl border border-white/5 relative group">
                      <div className="flex-1 grid grid-cols-12 gap-2">
                        <div className="col-span-6">
                          <input 
                            required
                            className="w-full bg-[#2a3942] border border-white/5 rounded-xl px-3 py-2.5 text-xs text-[#e9edef] outline-none focus:border-[#00a884] transition-all placeholder:text-[#8696a0]/30"
                            placeholder={isUrdu ? "دوا کا نام" : "Medicine Name"}
                            value={item.name}
                            onChange={e => handleUpdateItemField(item.id, 'name', e.target.value)}
                          />
                        </div>
                        <div className="col-span-3">
                          <input 
                            className="w-full bg-[#2a3942] border border-white/5 rounded-xl px-2 py-2.5 text-xs text-[#e9edef] outline-none focus:border-[#00a884] transition-all text-center placeholder:text-[#8696a0]/30"
                            placeholder={isUrdu ? "مقدار" : "Qty"}
                            value={item.quantity}
                            onChange={e => handleUpdateItemField(item.id, 'quantity', e.target.value)}
                          />
                        </div>
                        <div className="col-span-3">
                          <input 
                            required
                            type="number"
                            className="w-full bg-[#2a3942] border border-white/5 rounded-xl px-3 py-2.5 text-xs text-[#e9edef] outline-none focus:border-[#00a884] transition-all font-bold text-right placeholder:text-[#8696a0]/30"
                            placeholder={isUrdu ? "قیمت" : "Price"}
                            value={item.price}
                            onChange={e => handleUpdateItemField(item.id, 'price', e.target.value)}
                          />
                        </div>
                      </div>

                      {items.length > 1 && (
                        <button 
                          type="button"
                          onClick={() => handleDeleteItemRow(item.id)}
                          className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button 
                  type="button"
                  onClick={handleAddItemRow}
                  className="w-full flex items-center justify-center gap-1.5 py-3 text-xs bg-[#00a884]/15 hover:bg-[#00a884]/25 text-[#00a884] border border-[#00a884]/20 rounded-2xl font-bold transition-all uppercase tracking-wider"
                >
                  <Plus size={14} />
                  {t.addMedicine}
                </button>
              </div>
            )}

            {/* Receipt Attachment Container */}
            <div className="bg-black/20 p-4 rounded-3xl border border-white/5 space-y-2.5">
              <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block px-1">
                {t.addAttachment}
              </label>
              
              {!attachment ? (
                <div 
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => { 
                    e.preventDefault(); 
                    setIsDragging(false); 
                    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]); 
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2",
                    isDragging ? "border-[#00a884] bg-[#00a884]/15 text-[#00a884]" : "border-white/10 text-[#8696a0] hover:border-[#00a884]/40 hover:bg-white/5"
                  )}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*"
                    onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
                  />
                  <Paperclip size={22} />
                  <p className="text-xs transition-colors">{t.dragDropFile}</p>
                  <p className="text-[9px] text-[#8696a0]/40 font-mono">Max 800KB</p>
                </div>
              ) : (
                <div className="flex items-center justify-between bg-[#2a3942] p-3 rounded-2xl border border-[#00a884]/40">
                  <div className="flex items-center gap-3 overflow-hidden min-w-0">
                    <img 
                      src={attachment.url} 
                      alt="uploaded receipt thumbnail" 
                      className="w-11 h-11 object-cover rounded-xl border border-white/10 shrink-0" 
                    />
                    <div className="overflow-hidden min-w-0">
                      <p className="text-xs text-[#e9edef] truncate font-semibold font-mono">{attachment.name}</p>
                      <p className="text-[9px] text-[#00a884] font-bold tracking-wider uppercase">{isUrdu ? 'کامیابی سے منسلک' : 'Successfully Attached'}</p>
                    </div>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setAttachment(null)}
                    className="p-2 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-2 px-1">
                  {activeTab === 'suppliers' ? t.totalAmount : t.amount}
                </label>
                {activeTab === 'suppliers' ? (
                  <div className="w-full bg-[#111b21] border border-white/5 rounded-2xl px-5 py-4 text-[#00a884] text-lg font-bold flex items-center h-[60px]">
                    Rs. {computedTotalAmount.toLocaleString()}
                  </div>
                ) : (
                  <input 
                    type="number"
                    required
                    className="w-full bg-[#2a3942] border border-white/5 rounded-2xl px-5 py-4 text-[#e9edef] text-lg outline-none focus:border-[#00a884] transition-all font-bold"
                    placeholder="0.00"
                    value={formData.amount}
                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  />
                )}
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-2 px-1">
                  {activeTab === 'customers' ? t.expectedDate : t.dueDate}
                </label>
                <input 
                  type="date"
                  required
                  className="w-full bg-[#2a3942] border border-white/5 rounded-2xl px-5 py-4 text-[#e9edef] text-sm outline-none focus:border-[#00a884] transition-all [color-scheme:dark]"
                  value={formData.dueDate}
                  onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
                />
              </div>
            </div>
          </div>

          <button className="w-full bg-[#00a884] text-white py-4.5 rounded-2xl font-bold text-lg shadow-[0_8px_20px_rgba(0,168,132,0.3)] hover:bg-[#00c99a] active:scale-[0.98] transition-all flex items-center justify-center gap-3 mt-6">
            {t.addRecord}
            <ArrowRight size={22} className={cn(isUrdu && "rotate-180")} />
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function RecordPaymentModal({
  record,
  onClose,
  onRecord,
  isUrdu
}: {
  record: SupplierRecord,
  onClose: () => void,
  onRecord: (p: { amount: number; date: string; method: string; note?: string }) => void,
  isUrdu: boolean
}) {
  const calcs = getSupplierDueCalculations(record, new Date());
  const maxAmount = calcs.remaining;

  const [formData, setFormData] = useState({
    amount: maxAmount.toString(),
    date: format(new Date(), 'yyyy-MM-dd'),
    method: 'Cash',
    note: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payAmount = Number(formData.amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      alert(isUrdu ? 'براہ کرم درست رقم درج کریں' : 'Please enter a valid amount');
      return;
    }
    if (payAmount > maxAmount) {
      alert(isUrdu 
        ? `ادائیگی کی رقم باقی بقایا رقم (Rs. ${maxAmount.toLocaleString()}) سے زیادہ نہیں ہو سکتی` 
        : `Payment amount cannot exceed remaining balance (Rs. ${maxAmount.toLocaleString()})`
      );
      return;
    }

    onRecord({
      amount: payAmount,
      date: formData.date,
      method: formData.method,
      note: formData.note.trim() || undefined
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="bg-[#202c33] w-full max-w-lg rounded-t-3xl sm:rounded-3xl pb-10 sm:pb-6 overflow-hidden border-t sm:border border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
      >
        <div className="bg-[#2a3942] p-5 text-[#e9edef] flex justify-between items-center border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#00a884]/20 rounded-xl flex items-center justify-center text-[#00a884]">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <h2 className="font-bold text-base leading-tight">
                {isUrdu ? 'ادائیگی درج کریں' : 'Record Payment'}
              </h2>
              <p className="text-[10px] text-[#8696a0] font-bold uppercase tracking-wider">
                {record.supplierName}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors cursor-pointer"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="bg-black/10 p-4 rounded-2xl border border-white/5 flex justify-between items-center">
              <span className="text-xs text-[#8696a0]">
                {isUrdu ? 'کل بقایا رقم' : 'Remaining Balance'}
              </span>
              <span className="font-bold text-base text-[#00a884] font-mono">
                Rs. {maxAmount.toLocaleString()}
              </span>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-2 px-1">
                {isUrdu ? 'ادائیگی کی رقم' : 'Payment Amount'}
              </label>
              <input 
                type="number"
                required
                autoFocus
                className="w-full bg-[#2a3942] border border-white/5 rounded-2xl px-5 py-4 text-[#e9edef] text-lg outline-none focus:border-[#00a884] transition-all font-bold"
                placeholder="0"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-2 px-1">
                  {isUrdu ? 'تاریخ' : 'Date'}
                </label>
                <input 
                  type="date"
                  required
                  className="w-full bg-[#2a3942] border border-white/5 rounded-2xl px-5 py-4 text-[#e9edef] text-sm outline-none focus:border-[#00a884] transition-all [color-scheme:dark]"
                  value={formData.date}
                  onChange={e => setFormData({ ...formData, date: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-2 px-1">
                  {isUrdu ? 'طریقہ کار' : 'Method'}
                </label>
                <select 
                  className="w-full bg-[#2a3942] border border-white/5 rounded-2xl px-5 py-4 text-[#e9edef] text-sm outline-none focus:border-[#00a884] transition-all"
                  value={formData.method}
                  onChange={e => setFormData({ ...formData, method: e.target.value })}
                >
                  <option value="Cash">{isUrdu ? 'نقد (Cash)' : 'Cash'}</option>
                  <option value="Bank Transfer">{isUrdu ? 'بینک ٹرانسفر' : 'Bank Transfer'}</option>
                  <option value="Cheque">{isUrdu ? 'چیک (Cheque)' : 'Cheque'}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-2 px-1">
                {isUrdu ? 'تفصیل (اختیاری)' : 'Note (Optional)'}
              </label>
              <textarea 
                className="w-full bg-[#2a3942] border border-white/5 rounded-2xl px-5 py-3 text-[#e9edef] text-sm outline-none focus:border-[#00a884] transition-all min-h-[70px] resize-none placeholder:text-[#8696a0]/30"
                placeholder={isUrdu ? 'ادائیگی کی تفصیل یہاں درج کریں...' : 'Enter details here...'}
                value={formData.note}
                onChange={e => setFormData({ ...formData, note: e.target.value })}
              />
            </div>
          </div>

          <button className="w-full bg-[#00a884] text-white py-4.5 rounded-2xl font-bold text-lg shadow-[0_8px_20px_rgba(0,168,132,0.3)] hover:bg-[#00c99a] active:scale-[0.98] transition-all flex items-center justify-center gap-3 mt-6 cursor-pointer">
            {isUrdu ? 'ادائیگی محفوظ کریں' : 'Record Payment'}
            <ArrowRight size={22} className={cn(isUrdu && "rotate-180")} />
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function SettingsPanel({ 
  settings, 
  setSettings, 
  t, 
  records, 
  setRecords,
  user,
  setUser,
  accessToken,
  setAccessToken,
  isSyncing,
  handleSheetsSync,
  isGuest,
  setIsGuest
}: { 
  settings: AppSettings, 
  setSettings: any, 
  t: any, 
  records: AppRecord[], 
  setRecords: any,
  user: any,
  setUser: any,
  accessToken: string | null,
  setAccessToken: any,
  isSyncing: boolean,
  handleSheetsSync: (token?: string, id?: string) => Promise<void>,
  isGuest: boolean,
  setIsGuest: (val: boolean) => void
}) {
  const isUrdu = settings.language === 'ur';

  const clearData = () => {
    if (confirm(t.clearAllData + '?')) {
      setRecords([]);
      alert(isUrdu ? 'ترمیم مکمل!' : 'Done!');
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const result = await googleSignIn(true);
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        if (settings.googleSheetsId) {
          await handleSheetsSync(result.accessToken, settings.googleSheetsId);
        }
      }
    } catch (err: any) {
      console.error(err);
      alert(isUrdu ? 'لاگ ان کرنے میں خرابی پیش آئی' : `Login failed: ${err.message || err}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      await logout();
      setUser(null);
      setAccessToken(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateNewSheet = async () => {
    if (!accessToken) return;
    try {
      const result = await createSpreadsheet(accessToken);
      setSettings((prev: any) => ({
        ...prev,
        googleSheetsId: result.spreadsheetId,
        googleSheetsUrl: result.spreadsheetUrl
      }));
      await handleSheetsSync(accessToken, result.spreadsheetId);
    } catch (err: any) {
      console.error(err);
      alert(isUrdu ? 'گوگل شیٹ بنانے میں خرابی پیش آگئی' : `Failed to create spreadsheet: ${err.message || err}`);
    }
  };

  const exportToCSV = () => {
    if (records.length === 0) {
      alert(t.noRecords);
      return;
    }

    const headers = ["ID", "Type", "Name", "Phone", "Description/Items", "Quantity Detail", "Amount", "Date", "Due Date", "Status"];
    const csvRows = records.map(r => {
      let desc = r.description || '';
      let qty = r.quantity || '-';
      
      if (r.type === 'supplier' && r.items && r.items.length > 0) {
        desc = r.items.map(item => `${item.name} (${item.quantity || '1'}) - Rs. ${item.price}`).join(' | ');
        qty = r.items.map(item => `${item.name}: ${item.quantity || '1'}`).join(' | ');
      }

      return [
        r.id,
        r.type,
        r.type === 'customer' ? r.customerName : r.supplierName,
        r.type === 'customer' ? r.phoneNumber : '-',
        desc.replace(/,/g, ' '),
        qty.replace(/,/g, ' '),
        r.amount,
        r.date,
        r.dueDate,
        r.status
      ].join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `asquafmedical_report_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const supplierSummary = useMemo(() => {
    return records
      .filter(r => r.type === 'supplier')
      .map(r => {
        const calcs = getSupplierDueCalculations(r as SupplierRecord, new Date());
        return { 
          ...r, 
          remaining: calcs.remaining,
          status: calcs.status,
          daysLeft: calcs.daysDiff 
        };
      })
      .filter(s => s.status !== 'settled')
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [records]);

  const { totalOutstanding, totalDueToday } = useMemo(() => {
    let outstanding = 0;
    let dueToday = 0;
    supplierSummary.forEach(s => {
      outstanding += s.remaining;
      if (s.status === 'due-today' || s.daysLeft === 0) {
        dueToday += s.remaining;
      }
    });
    return { totalOutstanding: outstanding, totalDueToday: dueToday };
  }, [supplierSummary]);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-6 pb-12"
    >
      {/* Summary Card */}
      {supplierSummary.length > 0 && (
        <div className="bg-[#202c33] rounded-3xl shadow-xl border border-white/5 overflow-hidden">
          <div className="bg-[#005c4b] p-4 text-[#e9edef] flex items-center gap-3">
            <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
              <Bell size={18} className="text-[#00a884]" />
            </div>
            <h3 className="font-bold text-sm tracking-wide">{t.summaryTitle}</h3>
          </div>

          <div className="grid grid-cols-2 gap-3 p-4 bg-[#111b21]/50 border-b border-white/5">
            <div className="bg-[#111b21] p-3 rounded-2xl border border-white/5">
              <span className="text-[10px] text-[#8696a0] uppercase font-bold tracking-wider block">
                {settings.language === 'ur' ? 'کل واجب الادا رقم' : 'Total Outstanding'}
              </span>
              <span className="text-base font-extrabold text-[#e9edef] mt-0.5 block">
                Rs. {totalOutstanding.toLocaleString()}
              </span>
            </div>
            <div className="bg-[#111b21] p-3 rounded-2xl border border-white/5">
              <span className="text-[10px] text-yellow-500 uppercase font-bold tracking-wider block">
                {settings.language === 'ur' ? 'آج واجب الادا' : 'Due Today'}
              </span>
              <span className="text-base font-extrabold text-yellow-500 mt-0.5 block">
                Rs. {totalDueToday.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className={cn("w-full text-sm", isUrdu && "text-right")}>
              <thead>
                <tr className="bg-[#111b21] border-b border-white/5">
                  <th className="px-5 py-3 font-bold text-[#8696a0] text-[10px] uppercase tracking-widest">{t.supplierName}</th>
                  <th className="px-5 py-3 font-bold text-[#8696a0] text-[10px] uppercase tracking-widest">{t.amount}</th>
                  <th className="px-5 py-3 font-bold text-[#8696a0] text-[10px] uppercase tracking-widest">{t.dueIn}</th>
                </tr>
              </thead>
              <tbody>
                {supplierSummary.map((s: any) => (
                  <tr key={s.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-4 font-medium text-[#e9edef]">{s.supplierName}</td>
                    <td className="px-5 py-4 text-[#00a884] font-bold text-base">Rs. {s.remaining.toLocaleString()}</td>
                    <td className="px-5 py-4">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider inline-block border",
                        s.daysLeft <= 0 
                          ? "bg-red-500/10 text-red-500 border-red-500/20" 
                          : (s.daysLeft <= 2 ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" : "bg-[#00a884]/10 text-[#00a884] border-[#00a884]/20")
                      )}>
                        {s.daysLeft <= 0 ? t.overdue : `${s.daysLeft} ${t.daysLeft}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Google Sheets Sync Card */}
      <div className="bg-[#202c33] rounded-3xl shadow-xl border border-white/5 overflow-hidden">
        <div className="bg-[#005c4b] p-4 text-[#e9edef] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
              <FileSpreadsheet size={18} className="text-[#00a884]" />
            </div>
            <h3 className="font-bold text-sm tracking-wide">{t.connectGoogleSheets}</h3>
          </div>
          {accessToken && (
            <span className="flex items-center gap-1.5 bg-[#00a884]/20 border border-[#00a884]/30 px-2 py-0.5 rounded-full text-[9px] font-bold text-[#00a884] uppercase tracking-wider">
              <span className="w-1.5 h-1.5 bg-[#00a884] rounded-full animate-pulse" />
              {settings.language === 'ur' ? 'منسلک ہے' : 'Connected'}
            </span>
          )}
        </div>
        
        <div className="p-6 space-y-5">
          {!accessToken ? (
            <div className="space-y-4">
              <p className="text-xs text-[#8696a0] leading-relaxed">
                {settings.language === 'ur' 
                  ? 'اپنے گاہکوں اور سپلائرز کے ادھار کا تمام ڈیٹا گوگل شیٹس پر محفوظ اور سنک کریں۔ یہ خصوصیت آپ کی اجازت سے آپ کے گوگل اکاؤنٹ پر براہ راست کام کرتی ہے۔'
                  : 'Backup and sync all customer and supplier credit records into formatted Google Sheets. This applet will secure your data and compile sheets automatically with your permission.'}
              </p>
              
              <button 
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 font-bold py-4 rounded-2xl shadow-md hover:bg-gray-100 active:scale-[0.98] transition-all text-sm uppercase tracking-wider"
              >
                <LogIn size={18} />
                {settings.language === 'ur' ? 'گوگل اکاؤنٹ لاگ ان کریں' : 'Sign in with Google'}
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* User profile details if available */}
              {user && (
                <div className="flex items-center gap-3 bg-[#111b21] p-3 rounded-2xl border border-white/5">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName} className="w-10 h-10 rounded-full border border-white/10" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-10 h-10 bg-[#00a884]/20 rounded-full flex items-center justify-center text-[#00a884] font-bold text-sm">
                      {user.displayName?.[0] || 'U'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-[#e9edef] truncate">{user.displayName || 'Google User'}</p>
                    <p className="text-xs text-[#8696a0] truncate">{user.email}</p>
                  </div>
                </div>
              )}

              {/* Spreadsheets details */}
              {!settings.googleSheetsId ? (
                <div className="space-y-4 bg-[#2a3942]/50 p-4 rounded-2xl border border-white/5">
                  <p className="text-xs text-[#8696a0] leading-relaxed">
                    {settings.language === 'ur'
                      ? 'فی الحال کوئی گوگل شیٹ لکڈ نہیں ہے۔ اپ ڈیٹ شروع کرنے کیلئے ابھی نئی اسپریڈ شیٹ بنائیں۔'
                      : 'No linked spreadsheet found. Create a beautiful automated spreadsheet in your Drive now to start syncing.'}
                  </p>
                  
                  <button 
                    onClick={handleCreateNewSheet}
                    className="w-full flex items-center justify-center gap-2.5 bg-[#00a884] hover:bg-[#00c99a] text-white font-bold py-3.5 rounded-2xl shadow-lg transition-all text-sm"
                  >
                    <Plus size={18} />
                    {t.createSpreadsheet}
                  </button>

                  <div className="relative flex py-1.5 items-center">
                    <div className="flex-grow border-t border-white/5"></div>
                    <span className="flex-shrink mx-4 text-[9px] font-bold text-[#8696a0]/40 uppercase tracking-widest">{settings.language === 'ur' ? 'یا آئی ڈی درج کریں' : 'or link existing'}</span>
                    <div className="flex-grow border-t border-white/5"></div>
                  </div>

                  <div>
                    <input 
                      className="w-full bg-[#2a3942] border border-white/5 rounded-xl px-4 py-3 text-xs text-[#e9edef] outline-none focus:border-[#00a884] transition-all placeholder:text-[#8696a0]/30"
                      placeholder={settings.language === 'ur' ? 'اسپریڈ شیٹ آئی ڈی یہاں لکھیں' : 'Spreadsheet ID (from URL)'}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val) {
                          setSettings((prev: any) => ({
                            ...prev,
                            googleSheetsId: val,
                            googleSheetsUrl: `https://docs.google.com/spreadsheets/d/${val}/edit`
                          }));
                          handleSheetsSync(accessToken, val);
                        }
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-[#111b21] p-4 rounded-2xl border border-white/5 space-y-2">
                    <p className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest">{t.googleSheetsDocId}</p>
                    <p className="text-xs font-mono text-[#e9edef] truncate">{settings.googleSheetsId}</p>
                  </div>

                  {/* Buttons */}
                  <div className="grid grid-cols-2 gap-3">
                    {settings.googleSheetsUrl && (
                      <a 
                        href={settings.googleSheetsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 bg-[#2a3942] hover:bg-[#3b4a54] text-[#e9edef] border border-white/5 font-bold py-3.5 rounded-2xl transition-all text-xs"
                      >
                        <ExternalLink size={14} />
                        {t.viewSheet}
                      </a>
                    )}
                    <button 
                      onClick={() => handleSheetsSync()}
                      disabled={isSyncing}
                      className="flex items-center justify-center gap-2 bg-[#00a884] hover:bg-[#00c99a] text-white font-bold py-3.5 rounded-2xl shadow-lg transition-all text-xs disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={cn(isSyncing && "animate-spin")} />
                      {isSyncing ? (settings.language === 'ur' ? 'سنک ہو رہا ہے...' : 'Syncing...') : t.syncNow}
                    </button>
                  </div>

                  {/* Auto-Sync Toggle */}
                  <button 
                    onClick={() => {
                      setSettings((prev: any) => ({
                        ...prev,
                        googleSheetsAutoSync: !prev.googleSheetsAutoSync
                      }));
                    }}
                    className="w-full flex items-center justify-between p-4 bg-[#2a3942]/50 hover:bg-[#2a3942] rounded-2xl border border-white/5 transition-all text-left"
                  >
                    <div>
                      <p className="font-bold text-xs text-[#e9edef]">{t.autoSyncLabel}</p>
                      <p className="text-[10px] text-[#8696a0] mt-0.5">
                        {settings.language === 'ur'
                          ? 'ہر تبدیلی کے بعد ڈیٹا خود بخود گوگل شیٹس پر سنک ہو جائے گا'
                          : 'Automatically sync records to Google Sheets after any updates'}
                      </p>
                    </div>
                    <div className={cn(
                      "w-6 h-6 rounded-lg flex items-center justify-center border transition-all",
                      settings.googleSheetsAutoSync 
                        ? "bg-[#00a884] border-[#00a884] text-white" 
                        : "border-white/10 bg-[#111b21]"
                    )}>
                      {settings.googleSheetsAutoSync && <Check size={14} className="stroke-[3]" />}
                    </div>
                  </button>

                  {/* Disconnect Google Sheets Link */}
                  <div className="flex justify-between items-center pt-2">
                    <button 
                      onClick={() => {
                        setSettings((prev: any) => ({
                          ...prev,
                          googleSheetsId: '',
                          googleSheetsUrl: ''
                        }));
                      }}
                      className="text-xs text-yellow-500/80 hover:text-yellow-500 transition-colors"
                    >
                      {settings.language === 'ur' ? 'شیٹ ریلیز کریں' : 'Unlink Spreadsheet'}
                    </button>
                    <button 
                      onClick={handleDisconnect}
                      className="flex items-center gap-1.5 text-xs text-red-500/80 hover:text-red-500 bg-red-500/10 hover:bg-red-500/20 px-3.5 py-2 rounded-xl border border-red-500/20 transition-all font-semibold"
                    >
                      <LogOut size={12} />
                      {t.disconnect}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Settings Form */}
      <div className="bg-[#202c33] rounded-3xl shadow-xl border border-white/5 p-6 space-y-7">
        <div className="space-y-6">
          <div>
            <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-3 px-1">{t.pharmacyNameLabel}</label>
            <div className="relative">
              <Store className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8696a0]/50" size={18} />
              <input 
                className="w-full bg-[#2a3942] border border-white/5 rounded-2xl pl-12 pr-4 py-4 text-[#e9edef] outline-none focus:border-[#00a884] transition-all"
                value={settings.pharmacyName}
                onChange={e => setSettings({ ...settings, pharmacyName: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-3 px-1">{t.reminderTimeLabel}</label>
            <div className="relative">
              <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8696a0]/50" size={18} />
              <input 
                type="time"
                className="w-full bg-[#2a3942] border border-white/5 rounded-2xl pl-12 pr-4 py-4 text-[#e9edef] outline-none focus:border-[#00a884] transition-all [color-scheme:dark]"
                value={settings.reminderTime}
                onChange={e => setSettings({ ...settings, reminderTime: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-[#8696a0] uppercase tracking-widest block mb-3 px-1">{t.languageLabel}</label>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => setSettings({ ...settings, language: 'en' })}
                className={cn(
                  "py-4 rounded-2xl border-2 transition-all font-bold text-sm uppercase tracking-widest",
                  settings.language === 'en' ? "border-[#00a884] bg-[#00a884]/10 text-[#00a884]" : "border-white/5 text-[#8696a0] bg-[#2a3942]"
                )}
              >
                English
              </button>
              <button 
                onClick={() => setSettings({ ...settings, language: 'ur' })}
                className={cn(
                  "py-4 rounded-2xl border-2 transition-all font-bold text-sm",
                  settings.language === 'ur' ? "border-[#00a884] bg-[#00a884]/10 text-[#00a884]" : "border-white/5 text-[#8696a0] bg-[#2a3942]"
                )}
              >
                اردو
              </button>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-white/5 space-y-3">
          <button 
            onClick={exportToCSV}
            className="w-full flex items-center justify-center gap-3 text-[#00a884] font-bold py-4 bg-[#00a884]/10 hover:bg-[#00a884]/20 rounded-2xl transition-all border border-[#00a884]/20 text-sm uppercase tracking-widest"
          >
            <ArrowRight size={18} className={cn("rotate-90", isUrdu && "rotate-[270deg]")} />
            {t.exportData}
          </button>
          <button 
            onClick={clearData}
            className="w-full flex items-center justify-center gap-3 text-red-500/80 font-bold py-4 hover:bg-red-500/10 rounded-2xl transition-all border border-transparent hover:border-red-500/20 text-sm uppercase tracking-widest"
          >
            <Trash2 size={18} />
            {t.clearAllData}
          </button>
          <button 
            type="button"
            onClick={async () => {
              const confirmMsg = isUrdu 
                ? (isGuest ? 'کیا آپ آف لائن موڈ بند کرنا چاہتے ہیں؟' : 'کیا آپ واقعی سائن آؤٹ کرنا چاہتے ہیں؟')
                : (isGuest ? 'Do you want to exit Offline Mode?' : 'Are you sure you want to sign out?');
              
              if (confirm(confirmMsg)) {
                setIsGuest(false);
                try {
                  await logout();
                } catch (e) {
                  console.error("Logout error", e);
                }
                window.location.reload();
              }
            }}
            className="w-full flex items-center justify-center gap-3 text-red-400 font-extrabold py-4 bg-red-400/10 hover:bg-red-400/20 rounded-2xl transition-all border border-red-400/20 text-sm uppercase tracking-widest cursor-pointer"
          >
            <LogOut size={18} />
            {isGuest 
              ? (isUrdu ? 'آف لائن موڈ بند کریں' : 'Exit Offline Mode') 
              : (isUrdu ? 'سائن آؤٹ' : 'Sign Out')}
          </button>
        </div>
      </div>

      <div className="text-center text-[#8696a0]/40 text-[9px] uppercase tracking-[0.2em] font-bold pb-4">
        <p>AsquafMedical v2.0</p>
        <div className="flex items-center justify-center gap-1.5 mt-2">
          <span className="w-1 h-1 bg-[#00a884]/40 rounded-full" />
          <p>Secure Offline Storage</p>
          <span className="w-1 h-1 bg-[#00a884]/40 rounded-full" />
        </div>
      </div>
    </motion.div>
  );
}
