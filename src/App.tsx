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
  Paperclip
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

export default function App() {
  // State
  const [activeTab, setActiveTab] = useState<'customers' | 'suppliers' | 'settings'>('customers');
  const [records, setRecords] = useState<AppRecord[]>(() => {
    const saved = localStorage.getItem('pharmacy_records');
    return saved ? JSON.parse(saved) : [];
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
            setRecords(dbRecords);
            localStorage.setItem('pharmacy_records', JSON.stringify(dbRecords));
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
        if (record.status === 'paid') return;
        
        const dueDate = parseISO(record.dueDate);
        const alreadyNotified = notifiedRecords.includes(record.id);

        if (isToday(dueDate) && !alreadyNotified) {
          new Notification(settings.pharmacyName, {
            body: `${isUrdu ? 'آج واجب الادا' : 'Due today'}: ${record.type === 'customer' ? (record as CustomerRecord).customerName : (record as SupplierRecord).supplierName} - Rs. ${record.amount}`,
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

    const fullRecord = { ...newRecord, id, status } as AppRecord;

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

  // View records filter
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (activeTab === 'customers') return r.type === 'customer';
      if (activeTab === 'suppliers') return r.type === 'supplier';
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
            {filteredRecords.length === 0 ? (
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
            ) : (
              filteredRecords.map((record) => (
                <RecordBubble 
                  key={record.id} 
                  record={record} 
                  settings={settings}
                  onMarkPaid={markAsPaid}
                  onDelete={deleteRecord}
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

function RecordBubble({ 
  record, 
  settings, 
  onMarkPaid,
  onDelete 
}: { 
  key?: string;
  record: AppRecord;
  settings: AppSettings;
  onMarkPaid: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [showOptions, setShowOptions] = useState(false);
  const [viewFullImage, setViewFullImage] = useState(false);
  const t = TRANSLATIONS[settings.language];
  const isUrdu = settings.language === 'ur';

  const getStatusColor = () => {
    if (record.status === 'paid') return 'bg-[#111b21] text-[#8696a0] border-white/5';
    
    const dueDate = parseISO(record.dueDate);
    if (isToday(dueDate)) return 'bg-[#5c4b00] text-[#fecb00] border-white/10';
    if (isPast(dueDate)) return 'bg-[#4b1c1c] text-[#ff6a6a] border-white/10';
    return 'bg-[#005c4b] text-[#00a884] border-white/10';
  };

  const getDaysInfo = () => {
    if (record.status === 'paid') return null;
    const today = new Date();
    const dueDate = parseISO(record.dueDate);
    const diff = differenceInDays(dueDate, today);
    
    if (diff === 0) return t.dueToday;
    if (diff < 0) return `${Math.abs(diff)} ${t.daysOverdue}`;
    return `${diff} ${t.daysLeft}`;
  };

  const handleCall = () => {
    if (record.type === 'customer') {
      window.location.href = `tel:${record.phoneNumber}`;
    }
  };

  const handleWhatsApp = () => {
    if (record.type === 'customer') {
      const msg = t.whatsappTemplate(record.customerName, settings.pharmacyName, record.amount);
      window.open(`https://wa.me/${record.phoneNumber.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`);
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
        record.status === 'paid' && "opacity-60 bg-[#111b21] border-white/5"
      )}
    >
      <div className="flex justify-between items-start mb-2 gap-4">
        <div>
          <h3 className={cn("font-bold text-sm", record.type === 'customer' ? "text-[#e9edef]" : "text-[#00a884]")}>
            {record.type === 'customer' ? record.customerName : record.supplierName}
          </h3>
          {record.type === 'customer' && (
            <p className="text-[10px] text-[#8696a0] font-mono mt-0.5 tracking-tight">{record.phoneNumber}</p>
          )}
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right">
            <p className="font-bold text-base text-[#e9edef]">Rs. {record.amount.toLocaleString()}</p>
          </div>
          <div className="relative">
            <button 
              onClick={() => setShowOptions(!showOptions)}
              className="p-1 text-[#8696a0] hover:text-[#e9edef] transition-colors"
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
                      className="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-white/5 flex items-center gap-2"
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
        <div className="bg-black/20 px-2 py-1 rounded flex items-center gap-1.5 border border-white/5">
          <Clock size={10} className="text-[#8696a0]" />
          <span className="text-[#8696a0]">{format(parseISO(record.date), 'dd MMM')}</span>
        </div>
        <div className="bg-black/20 px-2 py-1 rounded flex items-center gap-1.5 border border-[#8696a0]/20">
          <Bell size={10} className="text-[#8696a0]" />
          <span className="text-[#8696a0]">{format(parseISO(record.dueDate), 'dd MMM')}</span>
        </div>
        {getDaysInfo() && (
          <span className={cn("px-2 py-1 rounded border font-bold uppercase tracking-wider", getStatusColor())}>
            {getDaysInfo()}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mt-1 pt-2.5 border-t border-white/5">
        <div className="flex gap-2">
          {record.status !== 'paid' && record.type === 'customer' && (
            <>
              <button 
                onClick={handleCall}
                className="w-9 h-9 rounded-full bg-[#2a3942] flex items-center justify-center text-[#e9edef] hover:bg-[#3b4a54] transition-colors border border-white/5 active:scale-90"
              >
                <Phone size={14} />
               </button>
              <button 
                onClick={handleWhatsApp}
                className="w-9 h-9 rounded-full bg-[#2a3942] flex items-center justify-center text-[#00a884] hover:bg-[#3b4a54] transition-colors border border-white/5 active:scale-90"
              >
                <MessageCircle size={14} />
              </button>
            </>
          )}
        </div>
        
        {record.status !== 'paid' ? (
          <button 
            onClick={() => onMarkPaid(record.id)}
            className="flex items-center gap-1.5 bg-[#00a884] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md hover:bg-[#00c99a] active:scale-95 transition-all"
          >
            <CheckCircle2 size={13} />
            {t.markPaid}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-[#00a884] font-bold text-[10px] uppercase tracking-widest italic bg-[#00a884]/10 px-3 py-1 rounded-full border border-[#00a884]/20">
            <CheckCircle2 size={13} />
            {t.cleared}
          </div>
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
      const result = await googleSignIn();
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
      .filter(r => r.type === 'supplier' && r.status !== 'paid')
      .map(r => {
        const diff = differenceInDays(parseISO(r.dueDate), new Date());
        return { ...r, daysLeft: diff };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [records]);

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
                    <td className="px-5 py-4 text-[#00a884] font-bold text-base">Rs. {s.amount.toLocaleString()}</td>
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
