import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  ShieldCheck,
  Lock,
  Copy,
  Receipt,
  AlertCircle,
  RefreshCw,
  Sun,
  Moon,
  CheckCircle2,
  Home,
  User,
  FileText,
  ChevronDown
} from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://xxx.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyXXX...';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface TransactionSession {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payment_token: string;
  metadata?: {
    resident_name?: string;
    resident_email?: string;
    resident_phone?: string;
    property_name?: string;
    property_logo?: string;
    purpose?: string;
    due_date?: string;
    room_number?: string;
    room_info?: string;
  };
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

export default function App() {
  const [transaction, setTransaction] = useState<(TransactionSession & { razorpay_key_id?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(805); // 13:25 countdown default
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }, [isDarkMode]);

  const getTokenFromURL = () => {
    const params = new URLSearchParams(window.location.search);
    const queryToken = params.get('token') || params.get('p');
    if (queryToken) return queryToken;

    const pathParts = window.location.pathname.split('/');
    const pIndex = pathParts.indexOf('p');
    if (pIndex !== -1 && pathParts[pIndex + 1]) {
      return pathParts[pIndex + 1];
    }
    return null;
  };

  const fetchSession = async (tokenStr: string) => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: funcError } = await supabase.functions.invoke('tenant-pay-get-session', {
        body: { token: tokenStr }
      });

      if (funcError || !data || data.success === false) {
        throw new Error(funcError?.message || data?.error || 'Failed to retrieve payment link details.');
      }

      const mappedTx: TransactionSession & { razorpay_key_id?: string } = {
        id: data.razorpay_order_id || '',
        razorpay_key_id: data.razorpay_key_id,
        amount: (data.amount_paise || 0) / 100,
        currency: data.currency || 'INR',
        status: data.is_paid ? 'PAID' : 'PENDING',
        payment_token: tokenStr,
        metadata: {
          resident_name: data.resident_name,
          resident_email: data.resident_email,
          resident_phone: data.resident_phone,
          property_name: data.hostel_name,
          property_logo: data.hostel_logo,
          purpose: data.description,
          due_date: data.expires_at,
          room_number: data.room_info || data.room_number || 'N/A',
          room_info: data.room_info || ''
        }
      };

      setTransaction(mappedTx);

      if (data.expires_at) {
        const remaining = Math.max(0, Math.floor((new Date(data.expires_at).getTime() - Date.now()) / 1000));
        setTimeLeft(remaining);
      }
    } catch (err: any) {
      setError(err.message || 'Unable to connect to the secure gateway.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = getTokenFromURL();
    if (token) {
      fetchSession(token);
    } else {
      setError('Invalid or missing payment link token.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading || error || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setError('This secure session has expired. Please request a new payment link.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loading, error, timeLeft]);

  const loadRazorpaySDK = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handlePayment = async () => {
    if (!transaction) return;

    try {
      setVerifying(true);
      const sdkLoaded = await loadRazorpaySDK();
      if (!sdkLoaded) {
        throw new Error('Razorpay SDK failed to load. Please check your internet connection.');
      }

      const options = {
        key: transaction.razorpay_key_id,
        amount: Math.round(transaction.amount * 100),
        currency: transaction.currency || 'INR',
        name: transaction.metadata?.property_name || 'Nestora Pay',
        description: transaction.metadata?.purpose || 'Hostel Rent Payment',
        image: transaction.metadata?.property_logo || undefined,
        order_id: transaction.id,
        prefill: {
          name: transaction.metadata?.resident_name || '',
          email: transaction.metadata?.resident_email || '',
          contact: transaction.metadata?.resident_phone || ''
        },
        theme: {
          color: '#22C55E'
        },
        handler: async function (response: any) {
          setVerifying(true);
          try {
            const { data: verifyData, error: verifyError } = await supabase.functions.invoke('tenant-pay-verify', {
              body: {
                payment_token: transaction.payment_token,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature
              }
            });

            if (verifyError || !verifyData || !verifyData.success) {
              throw new Error(verifyData?.error || 'Payment verification failed.');
            }

            setTransaction(prev => prev ? { ...prev, status: 'PAID' } : null);
          } catch (err: any) {
            setError(err.message || 'Verification failed. Please contact your hostel owner.');
          } finally {
            setVerifying(false);
          }
        },
        modal: {
          ondismiss: function () {
            setVerifying(false);
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err: any) {
      setError(err.message || 'Secure Checkout failed to initialize.');
      setVerifying(false);
    }
  };

  const copyRef = () => {
    if (!transaction) return;
    navigator.clipboard.writeText(transaction.payment_token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="center-state">
        <div className="spinner-ring"></div>
        <p style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: 13 }}>Connecting to secure checkout...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="center-state">
        <div className="error-circle">
          <AlertCircle size={28} color="var(--error)" />
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Unable to Proceed</h2>
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 280, fontSize: 12, lineHeight: 1.4, marginBottom: 20 }}>
          {error}
        </p>
        <button className="green-action-btn" onClick={() => window.location.reload()} style={{ width: 'auto', padding: '0 24px' }}>
          <RefreshCw size={14} />
          Retry Connection
        </button>
      </div>
    );
  }

  const formattedAmount = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: transaction?.currency || 'INR',
    maximumFractionDigits: 0
  }).format(transaction?.amount || 0);

  const isPaid = transaction?.status === 'PAID';
  const currentMonthStr = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const purposeRaw = transaction?.metadata?.purpose || '';
  const hasMonth = /(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(purposeRaw);
  const purposeLabel = hasMonth 
    ? purposeRaw 
    : (purposeRaw ? `${purposeRaw} - ${currentMonthStr}` : `Rent Payment - ${currentMonthStr}`);

  return (
    <div className="page-wrapper">
      <div className="page-container">

        {/* ── Top Header Matching Mockup ── */}
        <div className="top-nav-bar">
          <div className="nav-brand-group">
            {/* Green Nestora Logo Badge */}
            <div style={{
              width: 26, height: 26, borderRadius: 8, background: '#22C55E',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Home size={14} color="#FFFFFF" />
            </div>
            <span className="nav-brand-title">Nestora Pay</span>
            <div className="nav-verified-chip">
              <ShieldCheck size={11} />
              <span>Verified Portal</span>
            </div>
          </div>

          <div className="nav-theme-toggles">
            <div className="theme-icon-circle" onClick={() => setIsDarkMode(!isDarkMode)}>
              {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
            </div>
          </div>
        </div>

        {isPaid ? (
          /* ── PAYMENT SUCCESSFUL VIEW ── */
          <>
            <div className="mock-card" style={{ textAlign: 'center', padding: '28px 20px' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: 'var(--success-light)', border: '1px solid var(--success-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px'
              }}>
                <CheckCircle2 size={36} color="var(--success)" />
              </div>

              <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Payment Successful</h2>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 20 }}>
                Your rent payment has been received and confirmed.
              </p>

              <div className="card-section-header">
                <FileText size={14} color="var(--primary)" />
                <span className="card-section-title">Payment Details</span>
              </div>
              <div style={{ background: 'var(--card-dark-bg)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                <div className="resident-row">
                  <span className="resident-row-key">Transaction ID</span>
                  <span className="resident-row-val">{transaction?.payment_token?.substring(0, 14)}...</span>
                </div>
                <div className="resident-row">
                  <span className="resident-row-key">Date</span>
                  <span className="resident-row-val">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                <div className="resident-row">
                  <span className="resident-row-key">Type of Transaction</span>
                  <span className="resident-row-val">Razorpay Gateway</span>
                </div>
                <div className="resident-row">
                  <span className="resident-row-key">Total</span>
                  <span className="resident-row-val" style={{ color: 'var(--primary)', fontWeight: 900 }}>{formattedAmount}</span>
                </div>
                <div className="resident-row">
                  <span className="resident-row-key">Status</span>
                  <span style={{ color: 'var(--success)', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle2 size={12} /> Success
                  </span>
                </div>
              </div>
            </div>

            <button className="green-action-btn" onClick={() => window.print()}>
              <Receipt size={18} />
              Download Receipt
            </button>
          </>
        ) : (
          /* ── CHECKOUT FORM MATCHING MOCKUP SCREENSHOT ── */
          <>
            {/* 1. Session Expiry Banner */}
            <div className="expiry-session-banner">
              <div className="expiry-banner-text">
                <Lock size={13} color="var(--primary)" />
                <span>Secure checkout · Session expires in</span>
              </div>
              <div className="expiry-timer-chip">
                {formatTime(timeLeft)}
              </div>
            </div>

            {/* 2. Merchant / Property Card */}
            <div className="mock-card">
              <div className="hero-merchant-layout">
                <div className="hero-merchant-img-wrapper">
                  {transaction?.metadata?.property_logo ? (
                    <img src={transaction.metadata.property_logo} alt="property" className="hero-merchant-img" />
                  ) : (
                    <div className="hero-merchant-placeholder">
                      {transaction?.metadata?.property_name?.charAt(0) || 'G'}
                    </div>
                  )}
                  <div className="hero-verified-overlay">
                    <CheckCircle2 size={9} />
                    <span>Verified Partner</span>
                  </div>
                </div>

                <div className="hero-merchant-info">
                  <h2 className="hero-merchant-title">{transaction?.metadata?.property_name || 'GOOD SHEPHERD MENS PG'}</h2>
                  <p className="hero-merchant-sub">{purposeLabel}</p>
                  <div className="hero-ref-row" onClick={copyRef}>
                    <span>Ref: {transaction?.payment_token?.substring(0, 10)}...</span>
                    <Copy size={9} />
                    {copied && <span style={{ color: 'var(--success)', fontSize: 9 }}>Copied</span>}
                  </div>
                  <div className="hero-amount-txt">{formattedAmount}</div>
                </div>
              </div>
            </div>

            {/* 3. Resident Details Card */}
            <div className="mock-card">
              <div className="card-section-header">
                <User size={15} color="var(--primary)" />
                <span className="card-section-title">Resident Details</span>
              </div>
              <div className="resident-details-box">
                <div className="resident-table">
                  <div className="resident-row">
                    <span className="resident-row-key">Resident Name</span>
                    <span className="resident-row-val">{transaction?.metadata?.resident_name || 'Edwin Richard'}</span>
                  </div>
                  <div className="resident-row">
                    <span className="resident-row-key">Room / Cot No</span>
                    <span className="resident-row-val">{transaction?.metadata?.room_number || 'N/A'}</span>
                  </div>
                  <div className="resident-row">
                    <span className="resident-row-key">Mobile Number</span>
                    <span className="resident-row-val">{transaction?.metadata?.resident_phone || 'N/A'}</span>
                  </div>
                </div>

                <div className="room-badge-icon">
                  <Home size={18} />
                  <span>ROOM</span>
                </div>
              </div>
            </div>

            {/* 4. Invoice Details Card */}
            <div className="mock-card">
              <div className="card-section-header">
                <FileText size={15} color="var(--brand-purple)" />
                <span className="card-section-title">Invoice Details</span>
              </div>
              <div className="invoice-row">
                <span className="invoice-row-key">{purposeLabel}</span>
                <span className="invoice-row-val">{formattedAmount}</span>
              </div>
              <div className="invoice-divider"></div>
              <div className="invoice-row" style={{ fontSize: 13 }}>
                <span className="invoice-row-key" style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Total Amount Payable</span>
                <span className="invoice-row-val" style={{ fontSize: 15, fontWeight: 900, color: 'var(--primary)' }}>{formattedAmount}</span>
              </div>
            </div>

            {/* 5. Green Action Button (Replaces Payment Method section as requested) */}
            <button
              className="green-action-btn"
              onClick={handlePayment}
              disabled={verifying || timeLeft <= 0}
            >
              {verifying ? (
                <>
                  <div className="spinner-ring" style={{ width: 18, height: 18, borderWidth: 2, margin: 0, borderTopColor: '#fff' }}></div>
                  <span>Processing...</span>
                </>
              ) : (
                <span>Pay {formattedAmount}</span>
              )}
            </button>

            {/* Security Seals below button matching screenshot */}
            <div className="supports-methods-txt">
              <Lock size={11} />
              <span>Supports UPI, Cards, Netbanking & Wallets</span>
            </div>

            {/* Frequently Asked Questions Accordion */}
            <div style={{ marginTop: 24 }}>
              <span className="faq-header-label">FREQUENTLY ASKED QUESTIONS</span>

              <div className="faq-box-item" onClick={() => setFaqOpen(faqOpen === 0 ? null : 0)}>
                <div className="faq-q-row">
                  <span className="faq-q-txt">What is Nestora?</span>
                  <ChevronDown size={14} style={{ transform: faqOpen === 0 ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </div>
                {faqOpen === 0 && (
                  <p className="faq-a-txt">
                    Nestora is an all-in-one Smart Hostel & Property Management platform used by your hostel management to issue digital invoices, verify rent payments, and manage resident stays securely.
                  </p>
                )}
              </div>

              <div className="faq-box-item" onClick={() => setFaqOpen(faqOpen === 1 ? null : 1)}>
                <div className="faq-q-row">
                  <span className="faq-q-txt">Is my payment secure?</span>
                  <ChevronDown size={14} style={{ transform: faqOpen === 1 ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </div>
                {faqOpen === 1 && (
                  <p className="faq-a-txt">
                    Yes. Your transaction is directly processed through Razorpay PCI-DSS compliant bank servers. Your credentials are never stored.
                  </p>
                )}
              </div>

              <div className="faq-box-item" onClick={() => setFaqOpen(faqOpen === 2 ? null : 2)}>
                <div className="faq-q-row">
                  <span className="faq-q-txt">How long does verification take?</span>
                  <ChevronDown size={14} style={{ transform: faqOpen === 2 ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </div>
                {faqOpen === 2 && (
                  <p className="faq-a-txt">
                    Verification is instant. Upon payment completion, a digital receipt is issued immediately to both you and your property manager.
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Footer Matching Screenshot ── */}
        <div className="mock-footer">
          <div className="mock-footer-brand">
            <div style={{ width: 14, height: 14, borderRadius: 4, background: '#22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Home size={9} color="#fff" />
            </div>
            <span>© {new Date().getFullYear()} Nestora. All rights reserved.</span>
          </div>
          <p>Powered by Nestora SaaS — Simplifying Property Management.</p>
        </div>

      </div>
    </div>
  );
}
