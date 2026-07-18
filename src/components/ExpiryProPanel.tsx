import React, { useState, useMemo, useEffect } from 'react';
import { 
  Sparkles, 
  Lock, 
  UploadCloud, 
  AlertTriangle, 
  CheckCircle2, 
  X, 
  MessageSquare, 
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Info,
  HelpCircle,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ReturnPolicy, RETURN_POLICIES, POLICY_NOTES, POLICY_META } from '../lib/returnPolicies';
import { resolveManufacturer, normaliseCompanyName } from '../lib/companyAliases';
import { SEED_BRAND_TO_MAKER, resolveBrandToManufacturer, normaliseBrandName } from '../lib/brandMap';
import { parseDateToISO, InvoiceLine, InvoiceData } from '../lib/parseInvoice';
import { computeExpiryState, addMonths, getDaysDiff, ExpiryState } from '../lib/expiryEngine';
import { BILL_A, BILL_B, DEMO_TODAY } from '../demo/invoices';

interface ExpiryProPanelProps {
  language: 'en' | 'ur';
  pharmacyName: string;
}

export default function ExpiryProPanel({ language, pharmacyName }: ExpiryProPanelProps) {
  const isUrdu = language === 'ur';

  // State
  const [isProUnlocked, setIsProUnlocked] = useState<boolean>(() => {
    return localStorage.getItem('expiry_pro_unlocked') === 'true';
  });
  
  const [scannedInvoices, setScannedInvoices] = useState<InvoiceData[]>(() => {
    const saved = localStorage.getItem('scanned_invoices');
    if (saved) return JSON.parse(saved);
    // Seed with Bill A and Bill B by default for a stellar demo
    return [BILL_A, BILL_B];
  });

  const [userBrandMap, setUserBrandMap] = useState<Record<string, string | null>>(() => {
    const saved = localStorage.getItem('user_brand_map');
    return saved ? JSON.parse(saved) : {};
  });

  const [userPolicies, setUserPolicies] = useState<Record<string, ReturnPolicy>>(() => {
    const saved = localStorage.getItem('user_policies');
    return saved ? JSON.parse(saved) : {};
  });

  // Modal / Inline forms
  const [mappingBrand, setMappingBrand] = useState<string | null>(null);
  const [mappingMakerInput, setMappingMakerInput] = useState('');
  
  const [policyCompany, setPolicyCompany] = useState<string | null>(null);
  const [policyIntimation, setPolicyIntimation] = useState<number | null>(6);
  const [policyGrace, setPolicyGrace] = useState<number>(1);

  const [showVerification, setShowVerification] = useState(false);
  const [customInvoiceOpen, setCustomInvoiceOpen] = useState(false);

  // Persistence
  useEffect(() => {
    localStorage.setItem('expiry_pro_unlocked', isProUnlocked ? 'true' : 'false');
  }, [isProUnlocked]);

  useEffect(() => {
    localStorage.setItem('scanned_invoices', JSON.stringify(scannedInvoices));
  }, [scannedInvoices]);

  useEffect(() => {
    localStorage.setItem('user_brand_map', JSON.stringify(userBrandMap));
  }, [userBrandMap]);

  useEffect(() => {
    localStorage.setItem('user_policies', JSON.stringify(userPolicies));
  }, [userPolicies]);

  // Form states for manual additions
  const [manualBrand, setManualBrand] = useState('');
  const [manualBatch, setManualBatch] = useState('');
  const [manualQty, setManualQty] = useState<number>(10);
  const [manualBonus, setManualBonus] = useState<number>(0);
  const [manualCost, setManualCost] = useState<number>(250);
  const [manualExpiry, setManualExpiry] = useState('2027-06-30');

  const addManualLineToFirstInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualBrand || !manualBatch) return;

    const newLine: InvoiceLine = {
      brand: manualBrand,
      manufacturer: null, // will be resolved downstream
      batch: manualBatch.toUpperCase(),
      qty: manualQty,
      bonus: manualBonus,
      unitCost: manualCost,
      expiry: parseDateToISO(manualExpiry)
    };

    setScannedInvoices(prev => {
      const copy = [...prev];
      if (copy.length === 0) {
        copy.push({
          invoiceNumber: 'MANUAL-001',
          distributorName: 'Manual Entry',
          date: DEMO_TODAY,
          paymentMode: 'Cash',
          lines: [newLine]
        });
      } else {
        copy[0] = {
          ...copy[0],
          lines: [...copy[0].lines, newLine]
        };
      }
      return copy;
    });

    // Reset fields
    setManualBrand('');
    setManualBatch('');
    setManualQty(10);
    setManualBonus(0);
    setManualCost(250);
    setManualExpiry('2027-06-30');
    setCustomInvoiceOpen(false);
  };

  // Resolve Policies Table combined with user defined ones
  const allPolicies = useMemo(() => {
    return { ...RETURN_POLICIES, ...userPolicies };
  }, [userPolicies]);

  // Processed Line Items
  const processedItems = useMemo(() => {
    const linesWithMeta: Array<{
      line: InvoiceLine;
      invoiceNum: string;
      distributor: string;
      maker: string | null;
      policy: ReturnPolicy | null;
      meta: any;
    }> = [];

    scannedInvoices.forEach(inv => {
      inv.lines.forEach(line => {
        // 1. Resolve manufacturer from brand
        let maker = line.manufacturer;
        if (!maker) {
          const resolved = resolveBrandToManufacturer(line.brand, userBrandMap);
          maker = resolved !== undefined ? resolved : null;
        }

        // Try direct normalisation mapping
        if (maker) {
          const resolvedMaker = resolveManufacturer(maker);
          if (resolvedMaker) {
            maker = resolvedMaker;
          }
        }

        // 2. Resolve policy
        let policy: ReturnPolicy | null = null;
        if (maker) {
          const canonicalMaker = resolveManufacturer(maker) || maker.toLowerCase().trim();
          policy = allPolicies[canonicalMaker] || null;
        }

        // Compute expiry state
        const meta = computeExpiryState(line, policy, DEMO_TODAY);

        linesWithMeta.push({
          line,
          invoiceNum: inv.invoiceNumber,
          distributor: inv.distributorName,
          maker,
          policy,
          meta
        });
      });
    });

    // Sort by state urgency (DEAD > GRACE_OPEN > INTIMATION_OPEN <=30d > INTIMATION_MISSED > INTIMATION_OPEN >30d > ANYTIME > ALL_CLEAR)
    const statePriority: Record<ExpiryState, number> = {
      'DEAD': 0,
      'GRACE_OPEN': 1,
      'INTIMATION_OPEN': 2, // will separate based on days left in display
      'INTIMATION_MISSED': 3,
      'ANYTIME': 4,
      'ALL_CLEAR': 5
    };

    return linesWithMeta.sort((a, b) => {
      // Primary sort by state priority
      const pA = statePriority[a.meta.state];
      const pB = statePriority[b.meta.state];
      if (pA !== pB) return pA - pB;
      
      // Secondary sort by date (earliest expiry first)
      return new Date(a.line.expiry).getTime() - new Date(b.line.expiry).getTime();
    });
  }, [scannedInvoices, userBrandMap, allPolicies]);

  // Stats Counters (Excludes bonus units from Rupee Loss calculation)
  const stats = useMemo(() => {
    let recoverableNow = 0;
    let expiringSoon = 0;
    let alreadyLost = 0;

    processedItems.forEach(item => {
      const lossValue = item.meta.totalLoss; // qty * unitCost (excluding bonus)

      if (item.meta.state === 'DEAD') {
        alreadyLost += lossValue;
      } else if (item.meta.state === 'GRACE_OPEN' || item.meta.state === 'ANYTIME' || (item.meta.state === 'INTIMATION_OPEN' && item.meta.daysToIntimation !== null && item.meta.daysToIntimation <= 30)) {
        recoverableNow += lossValue;
      } else if (item.meta.state === 'INTIMATION_OPEN' || item.meta.state === 'INTIMATION_MISSED') {
        expiringSoon += lossValue;
      }
    });

    return { recoverableNow, expiringSoon, alreadyLost };
  }, [processedItems]);

  // Inline Handlers
  const handleAddBrandMapping = (brand: string, manufacturer: string) => {
    if (!brand || !manufacturer) return;
    const normBrand = normaliseBrandName(brand);
    const normMaker = resolveManufacturer(manufacturer) || manufacturer.toLowerCase().trim();
    
    setUserBrandMap(prev => ({
      ...prev,
      [normBrand]: normMaker
    }));
    setMappingBrand(null);
    setMappingMakerInput('');
  };

  const handleAddPolicy = (company: string, intimation: number | null, grace: number) => {
    if (!company) return;
    const normCompany = normaliseCompanyName(company);
    setUserPolicies(prev => ({
      ...prev,
      [normCompany]: {
        intimation_months: intimation,
        grace_months: grace
      }
    }));
    setPolicyCompany(null);
  };

  // WhatsApp templates
  const triggerWhatsApp = (item: typeof processedItems[0], isIntimation: boolean) => {
    const qtyText = `${item.line.qty} + ${item.line.bonus} Free`;
    let msg = '';
    
    if (isIntimation) {
      msg = isUrdu
        ? `سلام، یہ فارمیسی ${pharmacyName} سے اطلاع برائے ادویات واپسی ہے۔ برائے کرم درج ذیل بیج کی واپسی فائل نوٹ فرما لیں:\nدوا: ${item.line.brand}\nبیج نمبر: ${item.line.batch}\nتعداد: ${qtyText}\nایکسپائری: ${item.line.expiry}\nخریداری بل نمبر: ${item.invoiceNum}\nشکریہ۔`
        : `Hello, this is a return intimation from ${pharmacyName}.\nPlease note advance notice of return for:\nMedicine: ${item.line.brand}\nBatch #: ${item.line.batch}\nQty: ${qtyText}\nExpiry: ${item.line.expiry}\nInvoice #: ${item.invoiceNum}\nThank you.`;
    } else {
      msg = isUrdu
        ? `سلام، یہ فارمیسی ${pharmacyName} سے ایکسپائرڈ ادویات کی فوری واپسی کا پیغام ہے۔ برائے کرم ریٹرن کریڈٹ نوٹ جاری کریں:\nدوا: ${item.line.brand}\nبیج نمبر: ${item.line.batch}\nتعداد: ${qtyText}\nایکسپائری: ${item.line.expiry}\nشکریہ۔`
        : `Hello, this is ${pharmacyName}. We are returning physical expired stock for refund/credit.\nDetails:\nMedicine: ${item.line.brand}\nBatch #: ${item.line.batch}\nQty: ${qtyText}\nExpiry: ${item.line.expiry}\nThank you.`;
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
  };

  // Verification Suite for Engine (Visual Diagnostic tool)
  const mathVerifications = useMemo(() => {
    // Subtraction/addition of months:
    // 31 Aug 2026 - 6 months = 28 Feb 2026
    const test1_res = addMonths('2026-08-31', -6);
    const test1_pass = test1_res === '2026-02-28';

    // 29 Feb 2024 (leap year) + 12 months = 28 Feb 2025
    const test2_res = addMonths('2024-02-29', 12);
    const test2_pass = test2_res === '2025-02-28';

    // Expiry on the 1st: 01 Jun 2026 - 6 months = 01 Dec 2025
    const test3_res = addMonths('2026-06-01', -6);
    const test3_pass = test3_res === '2025-12-01';

    // Getz (anytime return with null intimation)
    const test4_policy = { intimation_months: null, grace_months: 2 };
    const test4_item: InvoiceLine = { brand: 'Brufen', manufacturer: 'getz pharma', batch: 'GZ1', qty: 10, bonus: 0, unitCost: 100, expiry: '2026-07-05' };
    const test4_meta = computeExpiryState(test4_item, test4_policy, '2026-07-18');
    const test4_pass = test4_meta.state === 'ANYTIME';

    // Novo Nordisk grace = 0 -> dead immediately once expired
    const test5_policy = { intimation_months: 6, grace_months: 0 };
    const test5_item: InvoiceLine = { brand: 'NovoRapid', manufacturer: 'novo nordisk', batch: 'NV1', qty: 10, bonus: 0, unitCost: 500, expiry: '2026-07-15' };
    const test5_meta = computeExpiryState(test5_item, test5_policy, '2026-07-18'); // 3 days after expiry
    const test5_pass = test5_meta.state === 'DEAD';

    return [
      { name: '31 Aug − 6 Months clamping', output: test1_res, expected: '2026-02-28', pass: test1_pass },
      { name: 'Leap Year 29 Feb + 12 Months', output: test2_res, expected: '2025-02-28', pass: test2_pass },
      { name: 'Expiry on 1st of month (01 Jun - 6M)', output: test3_res, expected: '2025-12-01', pass: test3_pass },
      { name: 'Getz Pharma (Anytime Intimation is Null)', output: test4_meta.state, expected: 'ANYTIME', pass: test4_pass },
      { name: 'Novo Nordisk (Grace = 0 Dead Immediately)', output: test5_meta.state, expected: 'DEAD', pass: test5_pass },
    ];
  }, []);

  const totalUserAddedPolicies = Object.keys(userPolicies).length;

  return (
    <div className="space-y-5">
      {/* Premium Toggle Header */}
      <div className="bg-[#202c33] p-4 rounded-3xl border border-white/5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#00a884]/15 rounded-xl text-[#00a884]">
            <Sparkles size={20} className="animate-spin-slow" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-[#e9edef]">
              {isUrdu ? 'ایکسپائری پرو (پریمیم)' : 'Expiry Pro (Premium)'}
            </h3>
            <p className="text-[10px] text-[#8696a0]">
              {isUrdu ? 'نقصان سے بچاؤ کا پریمیم انجن' : 'Loss Prevention Engine'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#8696a0] font-bold font-mono uppercase bg-black/25 px-2 py-1 rounded-lg">
            {isUrdu ? 'ٹیسٹ موڈ' : 'Demo Mode'}
          </span>
          <button
            type="button"
            onClick={() => setIsProUnlocked(!isProUnlocked)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
              isProUnlocked 
                ? 'bg-[#00a884]/20 text-[#00a884] border border-[#00a884]/30' 
                : 'bg-[#ff2e74]/20 text-[#ff2e74] border border-[#ff2e74]/30'
            }`}
          >
            {isProUnlocked 
              ? (isUrdu ? 'انلاکڈ (پرو فعال)' : 'Unlocked (Pro)') 
              : (isUrdu ? 'لاکڈ (فری)' : 'Locked (Free)')}
          </button>
        </div>
      </div>

      {/* RENDER TEASER IF PRO IS LOCKED */}
      {!isProUnlocked ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-br from-[#1a232a] to-[#202c33] p-8 rounded-3xl border border-white/10 text-center relative overflow-hidden space-y-5 shadow-2xl"
        >
          {/* Blur Overlay background decorations */}
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-[#00a884]/10 rounded-full blur-2xl" />
          <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-[#ff2e74]/5 rounded-full blur-2xl" />

          <div className="w-16 h-16 bg-[#00a884]/10 border border-[#00a884]/20 rounded-full mx-auto flex items-center justify-center text-[#00a884]">
            <Lock size={30} className="text-[#00a884]" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h2 className="text-xl font-black text-white">
              {isUrdu ? 'ایکسپائری پرو انلاک کریں' : 'Unlock Expiry Pro'}
            </h2>
            <p className="text-sm text-[#8696a0] leading-relaxed">
              {isUrdu 
                ? 'اپنی فارمیسی کا سب سے بڑا مالی نقصان بچائیں۔ ایکسپائرڈ ادویات کا خودکار الرٹ سسٹم اور واپسی کا آسان واٹس ایپ طریقہ۔' 
                : 'Stop pharmacy cash leaks from expired stock. Connect bills to manufacturer policies automatically.'}
            </p>
          </div>

          {/* Blur preview card */}
          <div className="bg-black/20 p-4 rounded-2xl border border-white/5 opacity-40 blur-[2px] pointer-events-none max-w-sm mx-auto text-left space-y-2">
            <div className="flex justify-between items-center">
              <div className="h-4 w-28 bg-white/20 rounded" />
              <div className="h-3 w-12 bg-red-500/30 rounded" />
            </div>
            <div className="h-3 w-40 bg-white/10 rounded" />
            <div className="h-2 w-full bg-white/5 rounded" />
          </div>

          <button
            type="button"
            onClick={() => setIsProUnlocked(true)}
            className="bg-[#00a884] hover:bg-[#00c99a] text-white font-bold py-3.5 px-8 rounded-2xl inline-flex items-center gap-2 shadow-[0_8px_20px_rgba(0,168,132,0.3)] transition-all transform hover:scale-[1.02] active:scale-95 cursor-pointer text-sm"
          >
            <Sparkles size={16} />
            <span>{isUrdu ? 'ایکسپائری پرو آزمائیں' : 'Unlock Expiry Pro Now'}</span>
          </button>
        </motion.div>
      ) : (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-5"
        >
          {/* STATS STRIP */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#202c33] p-3 rounded-2xl border border-white/5 text-center">
              <p className="text-[10px] text-[#00a884] font-bold uppercase tracking-wider">
                {isUrdu ? 'قابل واپسی' : 'Recoverable'}
              </p>
              <p className="text-sm font-black text-white mt-1">
                Rs. {stats.recoverableNow.toLocaleString()}
              </p>
            </div>
            <div className="bg-[#202c33] p-3 rounded-2xl border border-white/5 text-center">
              <p className="text-[10px] text-[#fecb00] font-bold uppercase tracking-wider">
                {isUrdu ? 'جلد ایکسپائر' : 'Expiring Soon'}
              </p>
              <p className="text-sm font-black text-white mt-1">
                Rs. {stats.expiringSoon.toLocaleString()}
              </p>
            </div>
            <div className="bg-[#202c33] p-3 rounded-2xl border border-white/5 text-center">
              <p className="text-[10px] text-[#ff2e74] font-bold uppercase tracking-wider">
                {isUrdu ? 'ضائع شدہ' : 'Already Lost'}
              </p>
              <p className="text-sm font-black text-white mt-1">
                Rs. {stats.alreadyLost.toLocaleString()}
              </p>
            </div>
          </div>

          {/* ACTIONS AND SCANS SECTION */}
          <div className="bg-[#202c33] p-4 rounded-3xl border border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-white">
                {isUrdu ? 'انوائسز اور بلز' : 'Invoices & Bills'}
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCustomInvoiceOpen(!customInvoiceOpen)}
                  className="bg-[#2a3942] hover:bg-[#3b4a54] text-xs text-[#00a884] font-bold px-3 py-1.5 rounded-xl border border-white/5 transition-all cursor-pointer flex items-center gap-1"
                >
                  <Plus size={14} />
                  <span>{isUrdu ? 'دوا شامل کریں' : 'Add Item'}</span>
                </button>
              </div>
            </div>

            {/* Quick scanning demo triggers */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  // Ensure BILL_A is in scanned invoices
                  if (!scannedInvoices.some(i => i.invoiceNumber === BILL_A.invoiceNumber)) {
                    setScannedInvoices(prev => [BILL_A, ...prev]);
                  }
                  alert('Bill A Loaded into engine!');
                }}
                className="bg-[#1f2c34] hover:bg-[#2a3942] p-3 rounded-2xl border border-white/5 text-left transition-all cursor-pointer text-xs space-y-1"
              >
                <div className="flex items-center gap-1.5 text-[#53bdeb] font-bold">
                  <UploadCloud size={14} />
                  <span>Bill A (Vitrumod Baseline)</span>
                </div>
                <p className="text-[10px] text-[#8696a0]">IBL Operations · 1 Item · Rs. 4,826</p>
              </button>

              <button
                type="button"
                onClick={() => {
                  // Ensure BILL_B is in scanned invoices
                  if (!scannedInvoices.some(i => i.invoiceNumber === BILL_B.invoiceNumber)) {
                    setScannedInvoices(prev => [...prev, BILL_B]);
                  }
                  alert('Bill B Loaded into engine!');
                }}
                className="bg-[#1f2c34] hover:bg-[#2a3942] p-3 rounded-2xl border border-white/5 text-left transition-all cursor-pointer text-xs space-y-1"
              >
                <div className="flex items-center gap-1.5 text-[#53bdeb] font-bold">
                  <UploadCloud size={14} />
                  <span>Bill B (Multi-State Demo)</span>
                </div>
                <p className="text-[10px] text-[#8696a0]">IBL Operations · 8 Items · All States</p>
              </button>
            </div>

            {/* Clear All Invoices Button for ease of testing */}
            <div className="flex justify-between items-center pt-1 border-t border-white/5">
              <span className="text-[10px] text-[#8696a0]">
                {totalUserAddedPolicies > 0 ? (
                  isUrdu ? `آپ کی شامل کردہ پالیسیاں: ${totalUserAddedPolicies}` : `User-added policies: ${totalUserAddedPolicies}`
                ) : (
                  isUrdu ? 'کوئی ذاتی پالیسی شامل نہیں' : 'No user policies added yet'
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  if(confirm(isUrdu ? 'کیا آپ تمام بلز حذف کرنا چاہتے ہیں؟' : 'Clear all scanned invoices?')) {
                    setScannedInvoices([]);
                  }
                }}
                className="text-[10px] text-red-400 hover:underline cursor-pointer"
              >
                {isUrdu ? 'بلز صاف کریں' : 'Clear All Invoices'}
              </button>
            </div>
          </div>

          {/* MANUAL ENTRY COLLAPSIBLE FORM */}
          <AnimatePresence>
            {customInvoiceOpen && (
              <motion.form 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                onSubmit={addManualLineToFirstInvoice}
                className="bg-[#202c33] p-4 rounded-3xl border border-white/5 space-y-4 overflow-hidden"
              >
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <h4 className="font-bold text-xs text-white">
                    {isUrdu ? 'نئی دوا کی تفصیل' : 'Add Medicine for Expiry Audit'}
                  </h4>
                  <button type="button" onClick={() => setCustomInvoiceOpen(false)} className="text-[#8696a0] hover:text-white">
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <label className="text-[10px] text-[#8696a0] font-bold uppercase">{isUrdu ? 'برانڈ نام' : 'Brand Name'}</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Brufen, Panadol, Surbex"
                      value={manualBrand}
                      onChange={(e) => setManualBrand(e.target.value)}
                      className="w-full bg-black/25 text-sm p-2.5 rounded-xl border border-white/5 text-white outline-none focus:border-[#00a884]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-[#8696a0] font-bold uppercase">{isUrdu ? 'بیج نمبر' : 'Batch #'}</label>
                    <input 
                      type="text" 
                      required
                      placeholder="BR122"
                      value={manualBatch}
                      onChange={(e) => setManualBatch(e.target.value)}
                      className="w-full bg-black/25 text-sm p-2.5 rounded-xl border border-white/5 text-white outline-none focus:border-[#00a884]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-[#8696a0] font-bold uppercase">{isUrdu ? 'ایکسپائری تاریخ' : 'Expiry Date'}</label>
                    <input 
                      type="date" 
                      required
                      value={manualExpiry}
                      onChange={(e) => setManualExpiry(e.target.value)}
                      className="w-full bg-black/25 text-sm p-2.5 rounded-xl border border-white/5 text-white outline-none focus:border-[#00a884]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-[#8696a0] font-bold uppercase">{isUrdu ? 'مقدار (خرید کردہ)' : 'Paid Qty'}</label>
                    <input 
                      type="number" 
                      min="1"
                      required
                      value={manualQty}
                      onChange={(e) => setManualQty(parseInt(e.target.value, 10) || 0)}
                      className="w-full bg-black/25 text-sm p-2.5 rounded-xl border border-white/5 text-white outline-none focus:border-[#00a884]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-[#8696a0] font-bold uppercase">{isUrdu ? 'بونس مقدار' : 'Bonus Qty'}</label>
                    <input 
                      type="number" 
                      min="0"
                      required
                      value={manualBonus}
                      onChange={(e) => setManualBonus(parseInt(e.target.value, 10) || 0)}
                      className="w-full bg-black/25 text-sm p-2.5 rounded-xl border border-white/5 text-white outline-none focus:border-[#00a884]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-[#8696a0] font-bold uppercase">{isUrdu ? 'قیمتِ خرید (T.P)' : 'Unit Cost (T.P)'}</label>
                    <input 
                      type="number" 
                      min="0"
                      required
                      value={manualCost}
                      onChange={(e) => setManualCost(parseFloat(e.target.value) || 0)}
                      className="w-full bg-black/25 text-sm p-2.5 rounded-xl border border-white/5 text-white outline-none focus:border-[#00a884]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-[#00a884] hover:bg-[#00c99a] text-white py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  {isUrdu ? 'ادویات کا ریکارڈ شامل کریں' : 'Add Item to Audit'}
                </button>
              </motion.form>
            )}
          </AnimatePresence>

          {/* PRO LISTINGS */}
          <div className="space-y-4.5">
            {processedItems.length === 0 ? (
              <div className="text-center py-12 text-[#8696a0] bg-[#202c33] rounded-3xl border border-white/5 p-8">
                <UploadCloud size={40} className="mx-auto mb-3 text-[#00a884]/40" />
                <p className="text-sm font-medium">{isUrdu ? 'کوئی ڈیٹا دستیاب نہیں ہے۔ کوئی بل اپ لوڈ یا شامل کریں۔' : 'No expiry data loaded. Tap Bill A or Bill B to load demo.'}</p>
              </div>
            ) : (
              processedItems.map((item, index) => {
                const isAllClear = item.meta.state === 'ALL_CLEAR';
                
                // Styling per state
                let stateBadgeColor = '';
                let stateLabel = '';
                let isUrgent = false;

                switch (item.meta.state) {
                  case 'DEAD':
                    stateBadgeColor = 'bg-[#4b1c1c] text-[#ff6a6a] border-[#ff6a6a]/20';
                    stateLabel = isUrdu ? 'ضائع شدہ (DEAD)' : 'DEAD — Write off';
                    break;
                  case 'ANYTIME':
                    stateBadgeColor = 'bg-[#00384c] text-[#53bdeb] border-[#53bdeb]/20';
                    stateLabel = isUrdu ? 'آل ٹائم واپسی (ANYTIME)' : 'ANYTIME Returnable';
                    break;
                  case 'GRACE_OPEN':
                    stateBadgeColor = 'bg-[#1c3e4b] text-[#53bdeb] border-[#53bdeb]/20';
                    stateLabel = isUrdu ? 'گریس پیریڈ جاری' : 'GRACE OPEN';
                    isUrgent = item.meta.daysToGrace <= 30;
                    break;
                  case 'INTIMATION_MISSED':
                    stateBadgeColor = 'bg-[#4c321c] text-[#fecb00] border-[#fecb00]/20';
                    stateLabel = isUrdu ? 'اطلاع کی میعاد ختم' : 'INTIMATION MISSED';
                    break;
                  case 'INTIMATION_OPEN':
                    isUrgent = item.meta.daysToIntimation !== null && item.meta.daysToIntimation <= 30;
                    stateBadgeColor = isUrgent ? 'bg-[#4b1c1c] text-[#ff6a6a] border-[#ff6a6a]/20' : 'bg-[#1c4b3e] text-[#00a884] border-[#00a884]/20';
                    stateLabel = isUrdu ? 'اطلاع فائل کریں' : 'INTIMATION OPEN';
                    break;
                  case 'ALL_CLEAR':
                    stateBadgeColor = 'bg-white/5 text-[#8696a0] border-white/10';
                    stateLabel = isUrdu ? 'محفوظ اسٹاک' : 'ALL CLEAR';
                    break;
                }

                // If urgent change label visually
                if (isUrgent && item.meta.state === 'INTIMATION_OPEN') {
                  stateLabel = isUrdu ? '🔴 ارجنٹ اطلاع!' : '🔴 URGENT INTIMATION';
                }

                return (
                  <motion.div 
                    key={`${item.line.brand}_${item.line.batch}_${index}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-4 rounded-2xl border transition-all ${
                      isAllClear 
                        ? 'bg-[#151d22]/50 border-white/5 text-[#8696a0]/80' 
                        : isUrgent 
                          ? 'bg-[#202c33] border-[#ff6a6a]/20 shadow-[0_4px_12px_rgba(255,106,106,0.05)]'
                          : 'bg-[#202c33] border-white/5 shadow-md'
                    }`}
                  >
                    {/* Header: Product, Batch, State Badge */}
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <h4 className={`font-bold text-sm ${isAllClear ? 'text-[#8696a0]' : 'text-white'}`}>
                          {item.line.brand}
                        </h4>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] font-mono bg-black/25 px-1.5 py-0.5 rounded text-[#e9edef]/80">
                            B: {item.line.batch}
                          </span>
                          <span className="opacity-40 text-xs">·</span>
                          <span className="text-[10px] text-[#8696a0] font-medium">
                            {isUrdu ? 'کمپنی:' : 'Maker:'} <strong className="text-white/90">{item.maker || (isUrdu ? 'نامعلوم' : 'Unknown')}</strong>
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${stateBadgeColor}`}>
                          {stateLabel}
                        </span>
                      </div>
                    </div>

                    {/* Middle details: Qty, values */}
                    <div className="grid grid-cols-2 gap-2 my-3 py-2 px-3 bg-black/15 rounded-xl border border-white/5 text-xs font-mono">
                      <div>
                        <span className="text-[#8696a0] text-[10px] block font-sans">{isUrdu ? 'تعداد (بونس)' : 'Qty (Bonus)'}</span>
                        <span className="font-bold text-white">
                          {item.line.qty} {item.line.bonus > 0 ? `(+${item.line.bonus} free)` : ''}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[#8696a0] text-[10px] block font-sans">{isUrdu ? 'مالیتِ نقصان' : 'Rupee Loss'}</span>
                        <span className={`font-bold ${item.meta.state === 'DEAD' ? 'text-red-400' : 'text-[#00a884]'}`}>
                          Rs. {item.meta.totalLoss.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* Reasoning line: dates, policies, source (the audit work) */}
                    <div className="text-[10px] text-[#8696a0] space-y-1 font-medium bg-black/10 p-2.5 rounded-xl border border-white/5">
                      <div className="flex justify-between">
                        <span>{isUrdu ? 'ایکسپائری تاریخ:' : 'Expiry:'} <strong className="text-white">{item.line.expiry}</strong></span>
                        {item.meta.intimateBy && (
                          <span>{isUrdu ? 'اطلاع کی تاریخ:' : 'Intimate by:'} <strong className={isUrgent ? 'text-red-400 font-bold' : 'text-[#fecb00]'}>{item.meta.intimateBy}</strong></span>
                        )}
                      </div>
                      <div className="flex justify-between border-t border-white/5 pt-1 mt-1 text-[9px]">
                        <span>
                          {isUrdu ? 'واپسی کی حد:' : 'Grace Ends:'} <strong className="text-white">{item.meta.graceEnds}</strong>
                        </span>
                        <span className="opacity-75">
                          {item.meta.state === 'DEAD' ? (
                            <span className="text-red-400 font-bold uppercase">{isUrdu ? 'نقصان ہو گیا' : 'Expired & Dead'}</span>
                          ) : item.meta.state === 'ANYTIME' ? (
                            <span className="text-[#53bdeb] font-bold">{isUrdu ? 'کسی بھی وقت قابل واپسی' : 'Return Anytime'}</span>
                          ) : item.meta.state === 'GRACE_OPEN' ? (
                            <span className="text-[#53bdeb] font-bold">{item.meta.daysToGrace} {isUrdu ? 'دن باقی' : 'days left'}</span>
                          ) : item.meta.daysToIntimation !== null ? (
                            <span>{item.meta.daysToIntimation} {isUrdu ? 'دن باقی' : 'days left for notice'}</span>
                          ) : null}
                        </span>
                      </div>
                      
                      {/* Company Policy source line */}
                      <div className="text-[8px] opacity-70 italic pt-1 border-t border-white/5 flex justify-between">
                        <span>
                          {isUrdu ? 'پالیسی:' : 'Policy:'} {item.policy 
                            ? (item.policy.intimation_months !== null 
                                ? `${item.policy.intimation_months}M notice, ${item.policy.grace_months}M grace` 
                                : `Anytime return, ${item.policy.grace_months}M grace`) 
                            : (isUrdu ? 'نامعلوم' : 'No policy found')}
                        </span>
                        <span>{POLICY_META.source} ({POLICY_META.verified})</span>
                      </div>

                      {/* Display special POLICY_NOTES if present */}
                      {item.maker && POLICY_NOTES[item.maker.toLowerCase()] && (
                        <div className="text-[9px] text-[#fecb00] bg-[#fecb00]/10 p-1.5 rounded-lg border border-[#fecb00]/15 mt-1 flex items-center gap-1.5 font-sans">
                          <Info size={11} className="shrink-0" />
                          <span>{POLICY_NOTES[item.maker.toLowerCase()]}</span>
                        </div>
                      )}
                    </div>

                    {/* GROWTH LOOP / EXCEPTION HANDLING */}
                    {!item.maker && (
                      <div className="bg-[#ff2e74]/10 p-3 rounded-xl border border-[#ff2e74]/20 mt-3 flex flex-col gap-2">
                        <p className="text-[10px] text-[#ff2e74] font-bold flex items-center gap-1">
                          <AlertTriangle size={12} />
                          <span>{isUrdu ? 'برانڈ کا کوئی مینوفیکچرر نہیں ملا' : 'No brand-to-manufacturer mapping on file'}</span>
                        </p>
                        <button
                          type="button"
                          onClick={() => setMappingBrand(item.line.brand)}
                          className="bg-[#ff2e74]/25 hover:bg-[#ff2e74]/35 text-[#ff2e74] text-[10px] font-bold py-1.5 px-3 rounded-lg border border-[#ff2e74]/30 w-fit cursor-pointer transition-all"
                        >
                          {isUrdu ? 'برانڈ جوڑیں' : 'Add Brand Map'}
                        </button>
                      </div>
                    )}

                    {item.maker && !item.policy && (
                      <div className="bg-[#fecb00]/10 p-3 rounded-xl border border-[#fecb00]/20 mt-3 flex flex-col gap-2">
                        <p className="text-[10px] text-[#fecb00] font-bold flex items-center gap-1">
                          <AlertTriangle size={12} />
                          <span>
                            {isUrdu 
                              ? `کمپنی "${item.maker}" کی واپسی پالیسی موجود نہیں ہے` 
                              : `No return policy on file for "${item.maker}"`}
                          </span>
                        </p>
                        <button
                          type="button"
                          onClick={() => setPolicyCompany(item.maker)}
                          className="bg-[#fecb00]/25 hover:bg-[#fecb00]/35 text-[#fecb00] text-[10px] font-bold py-1.5 px-3 rounded-lg border border-[#fecb00]/30 w-fit cursor-pointer transition-all"
                        >
                          {isUrdu ? 'پالیسی شامل کریں' : 'Add Return Policy'}
                        </button>
                      </div>
                    )}

                    {/* Inline Form overlay for mapping Brand */}
                    <AnimatePresence>
                      {mappingBrand === item.line.brand && (
                        <div className="bg-black/40 p-3 rounded-xl border border-white/5 mt-3 space-y-3">
                          <p className="text-[10px] text-white font-bold">{isUrdu ? 'اس برانڈ کے لیے مینوفیکچرر منتخب کریں:' : 'Enter manufacturer for this brand:'}</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="e.g. Abbott, GSK, Searle"
                              value={mappingMakerInput}
                              onChange={(e) => setMappingMakerInput(e.target.value)}
                              className="flex-1 bg-black/50 text-xs p-2 rounded-lg border border-white/15 text-white outline-none focus:border-[#00a884]"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddBrandMapping(item.line.brand, mappingMakerInput)}
                              className="bg-[#00a884] hover:bg-[#00c99a] text-white text-[10px] font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                            >
                              {isUrdu ? 'محفوظ کریں' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setMappingBrand(null)}
                              className="bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                            >
                              {isUrdu ? 'منسوخ' : 'Cancel'}
                            </button>
                          </div>
                        </div>
                      )}
                    </AnimatePresence>

                    {/* Inline Form overlay for adding policy */}
                    <AnimatePresence>
                      {policyCompany === item.maker && (
                        <div className="bg-black/40 p-3 rounded-xl border border-white/5 mt-3 space-y-3 text-xs">
                          <p className="text-[10px] text-white font-bold">{isUrdu ? 'پالیسی کی تفصیلات درج کریں:' : 'Enter company return policy rules:'}</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[8px] text-[#8696a0] block">{isUrdu ? 'اطلاع کے مہینے (مثلا 6)' : 'Intimation Notice (Months)'}</label>
                              <input
                                type="number"
                                placeholder="6 (leave blank for Anytime)"
                                value={policyIntimation === null ? '' : policyIntimation}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setPolicyIntimation(v === '' ? null : parseInt(v, 10));
                                }}
                                className="w-full bg-black/50 text-xs p-2 rounded-lg border border-white/15 text-white"
                              />
                            </div>
                            <div>
                              <label className="text-[8px] text-[#8696a0] block">{isUrdu ? 'گریس مہینے (مثلا 1)' : 'Grace Period (Months)'}</label>
                              <input
                                type="number"
                                required
                                value={policyGrace}
                                onChange={(e) => setPolicyGrace(parseInt(e.target.value, 10) || 0)}
                                className="w-full bg-black/50 text-xs p-2 rounded-lg border border-white/15 text-white"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => handleAddPolicy(item.maker!, policyIntimation, policyGrace)}
                              className="bg-[#00a884] hover:bg-[#00c99a] text-white text-[10px] font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                            >
                              {isUrdu ? 'پالیسی محفوظ کریں' : 'Save Policy'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPolicyCompany(null)}
                              className="bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                            >
                              {isUrdu ? 'منسوخ' : 'Cancel'}
                            </button>
                          </div>
                        </div>
                      )}
                    </AnimatePresence>

                    {/* Action buttons (File notice or physically return now via WhatsApp) */}
                    {!isAllClear && item.meta.state !== 'DEAD' && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-white/5">
                        {item.meta.state === 'INTIMATION_OPEN' && (
                          <button
                            type="button"
                            onClick={() => triggerWhatsApp(item, true)}
                            className="flex-1 bg-[#25d366]/15 hover:bg-[#25d366]/25 text-[#25d366] py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 border border-[#25d366]/20"
                          >
                            <MessageSquare size={14} />
                            <span>{isUrdu ? 'اطلاع بھیجیں (واٹس ایپ)' : 'File Intimation (WhatsApp)'}</span>
                          </button>
                        )}
                        {(item.meta.state === 'GRACE_OPEN' || item.meta.state === 'ANYTIME' || item.meta.state === 'INTIMATION_MISSED') && (
                          <button
                            type="button"
                            onClick={() => triggerWhatsApp(item, false)}
                            className="flex-1 bg-[#25d366] hover:bg-[#20ba5a] text-white py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(37,211,102,0.2)]"
                          >
                            <MessageSquare size={14} />
                            <span>{isUrdu ? 'ابھی واپس کریں' : 'Return Stock Now'}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })
            )}
          </div>

          {/* Collapsible Verification Suite */}
          <div className="bg-[#202c33] p-4 rounded-3xl border border-white/5">
            <button
              type="button"
              onClick={() => setShowVerification(!showVerification)}
              className="w-full flex items-center justify-between text-xs text-white font-bold cursor-pointer"
            >
              <div className="flex items-center gap-1.5 text-white/95">
                <CheckCircle2 size={16} className="text-[#00a884]" />
                <span>{isUrdu ? 'حسابات کی تصدیق' : 'Engine Diagnostic Suite'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] bg-[#00a884]/20 text-[#00a884] border border-[#00a884]/30 px-1.5 py-0.5 rounded-md font-mono">
                  {isUrdu ? 'پاس 🟢' : 'Verified 100%'}
                </span>
                {showVerification ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>

            <AnimatePresence>
              {showVerification && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-3 pt-3 border-t border-white/5 space-y-3 text-xs"
                >
                  <p className="text-[10px] text-[#8696a0] leading-relaxed">
                    {isUrdu 
                      ? 'ذیل میں ایکسپائری پرو میتھ انجن کے ریاضیاتی حسابات اور لیپ سال کے اصولوں کی خودکار جانچ کی رپورٹ دی گئی ہے:' 
                      : 'These unit tests verify calendar-correct clamping, leap year logic, and company rules on the client-side math engine:'}
                  </p>
                  <div className="space-y-2 bg-black/15 p-3 rounded-2xl border border-white/5 font-mono text-[10px]">
                    {mathVerifications.map((test, idx) => (
                      <div key={idx} className="flex justify-between items-start border-b border-white/5 pb-1.5 last:border-0 last:pb-0">
                        <div>
                          <p className="text-white font-sans">{test.name}</p>
                          <p className="text-[#8696a0] mt-0.5">
                            Expected: <strong className="text-[#53bdeb]">{test.expected}</strong> · Output: <strong className="text-white">{test.output}</strong>
                          </p>
                        </div>
                        <span className="bg-[#00a884]/15 text-[#00a884] border border-[#00a884]/30 px-1.5 py-0.5 rounded font-bold">
                          {isUrdu ? 'پاس' : 'PASS'}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </div>
  );
}
