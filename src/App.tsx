import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  ShieldCheck, CheckCircle2, AlertCircle, Lock, Zap,
  Copy, ChevronDown, Clock, RefreshCw, Sun, Moon, Receipt
} from 'lucide-react';

declare global {
  interface Window {
    Razorpay: any;
  }
}

// Config variables with support for both Vite and Expo env prefixing
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || import.meta.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Create a Supabase Client
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
  };
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<TransactionSession | null>(null);
  const [copied, setCopied] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(15 * 60); // 15 mins countdown fallback

  // Theme Toggler
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
    }
  }, [isDarkMode]);

  // Extract payment token from URL query params or path (supports /?token=xyz or /p/xyz)
  const getTokenFromURL = () => {
    const params = new URLSearchParams(window.location.search);
    const queryToken = params.get('token') || params.get('p');
    if (queryToken) return queryToken;

    // Support clean URL path routing /p/:token
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

      // Invoke Supabase Edge Function to fetch token details safely
      const { data, error: funcError } = await supabase.functions.invoke('tenant-pay-get-session', {
        body: { token: tokenStr }
      });

      if (funcError || !data) {
        throw new Error(funcError?.message || 'Failed to retrieve payment link details.');
      }

      setTransaction(data);

      // Setup exact countdown timer based on expiry time if present
      if (data.metadata?.expires_at) {
        const remaining = Math.max(0, Math.floor((new Date(data.metadata.expires_at).getTime() - Date.now()) / 1000));
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

  // Timer countdown
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

  // Helper to load external checkout script dynamically
  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  // Trigger Razorpay Checkout overlay
  const handlePayment = async () => {
    if (!transaction) return;

    try {
      setVerifying(true);
      const isScriptLoaded = await loadRazorpayScript();
      if (!isScriptLoaded) {
        throw new Error('Razorpay Checkout failed to load. Please check your internet connection.');
      }

      // 1. Create order on the backend
      const { data: orderData, error: orderError } = await supabase.functions.invoke('tenant-pay-create-order', {
        body: { token: transaction.payment_token }
      });

      if (orderError || !orderData) {
        throw new Error(orderError?.message || 'Failed to initialize the secure order.');
      }

      const options = {
        key: orderData.razorpay_key_id,
        amount: orderData.amount,
        currency: orderData.currency,
        name: transaction.metadata?.property_name || 'Nestora Property',
        description: transaction.metadata?.purpose || 'Rent Payment',
        image: transaction.metadata?.property_logo || '/logo-light.png',
        order_id: orderData.razorpay_order_id,
        handler: async function (response: any) {
          // Payment succeeded in overlay, verify on backend
          try {
            setVerifying(true);
            const { data: verifyData, error: verifyError } = await supabase.functions.invoke('tenant-pay-verify', {
              body: {
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
                token: transaction.payment_token
              }
            });

            if (verifyError || !verifyData) {
              throw new Error(verifyError?.message || 'Payment verification failed.');
            }

            // Sync successful status
            setTransaction(prev => prev ? { ...prev, status: 'PAID' } : null);
          } catch (verifyErr: any) {
            setError(verifyErr.message || 'Payment was successful but verification failed. Please contact your property manager.');
          } finally {
            setVerifying(false);
          }
        },
        prefill: {
          name: transaction.metadata?.resident_name || '',
          email: transaction.metadata?.resident_email || '',
          contact: transaction.metadata?.resident_phone || ''
        },
        theme: {
          color: '#6F55F9' // Nestora Violet
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

  const copyPaymentToken = () => {
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

  // State Views
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
        <button className="pay-btn" onClick={() => window.location.reload()} style={{ width: 'auto', padding: '0 20px' }}>
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

  const isUrgent = timeLeft < 180; // less than 3 mins
  const isPaid = transaction?.status === 'PAID';

  return (
    <div className="page-wrapper">
      <div className="page-container">
        
        {/* Top Header */}
        <div className="top-header">
          <div className="brand-badge">
            <div className="brand-logo-placeholder">N</div>
            <span className="brand-name">Nestora Pay</span>
            <div className="brand-verified">
              <ShieldCheck size={11} color="var(--success)" />
              <span className="verified-label" style={{ color: 'var(--success)', textTransform: 'none', letterSpacing: 'normal' }}>Verified Portal</span>
            </div>
          </div>
          <div className="header-actions">
            <div className="theme-toggle" onClick={() => setIsDarkMode(!isDarkMode)}>
              {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
            </div>
            <div className="ssl-badge">
              <Lock size={10} color="var(--success)" />
              <span>SSL Secure</span>
            </div>
          </div>
        </div>

        {/* Success / Invoice Card */}
        <div className="glass-card">
          {isPaid ? (
            /* SUCCESS VIEW */
            <div style={{ textAlign: 'center' }}>
              <div className="success-circle">
                <CheckCircle2 size={32} color="var(--success)" />
              </div>
              <h1 className="success-title">Payment Successful</h1>
              <p className="success-subtitle">Your transaction has been securely processed and credited to your property manager.</p>

              <div className="glass-card-sm" style={{ textAlign: 'left', marginBottom: 16 }}>
                <div className="receipt-header">
                  <Receipt size={12} color="var(--primary)" />
                  <span className="receipt-title">Payment Receipt</span>
                  <span className="paid-badge" style={{ marginLeft: 'auto' }}>PAID</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Property Name</span>
                  <span className="detail-val">{transaction?.metadata?.property_name || 'Nestora Property'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Resident Name</span>
                  <span className="detail-val">{transaction?.metadata?.resident_name}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Paid Amount</span>
                  <span className="detail-val" style={{ color: 'var(--success)', fontWeight: 800 }}>{formattedAmount}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Receipt Reference</span>
                  <span className="detail-val" style={{ fontFamily: 'monospace' }}>
                    {transaction?.payment_token.substring(0, 14)}...
                  </span>
                </div>
              </div>

              <button className="pay-btn" onClick={() => window.print()} style={{ background: 'var(--card-dark-bg)', color: 'var(--text-primary)', border: '1px solid var(--card-border)' }}>
                <Receipt size={14} />
                Download Receipt
              </button>
            </div>
          ) : (
            /* PAYMENT CHECKOUT VIEW */
            <>
              {/* Countdown Timer */}
              <div className={`timer-bar ${isUrgent ? 'urgent' : ''}`}>
                <div className="timer-label">
                  <Clock size={13} color={isUrgent ? 'var(--error)' : 'var(--text-secondary)'} />
                  <span>Secure Checkout Session expires in:</span>
                </div>
                <div className={`timer-badge ${isUrgent ? 'urgent' : ''}`}>
                  {formatTime(timeLeft)}
                </div>
              </div>

              {/* Property Details */}
              <div className="property-header">
                {transaction?.metadata?.property_logo ? (
                  <img src={transaction.metadata.property_logo} alt="property" className="property-logo" />
                ) : (
                  <div className="property-logo-placeholder">
                    {transaction?.metadata?.property_name?.charAt(0) || 'P'}
                  </div>
                )}
                <div>
                  <h2 className="property-name">{transaction?.metadata?.property_name || 'Hostel / PG Partner'}</h2>
                  <div className="copy-ref" onClick={copyPaymentToken}>
                    <span>Ref: <strong>{transaction?.payment_token.substring(0, 10)}...</strong></span>
                    <Copy size={9} color="var(--primary)" />
                    {copied && <span style={{ color: 'var(--success)', fontSize: 8, marginLeft: 2 }}>Copied</span>}
                  </div>
                </div>
              </div>

              {/* Amount Display */}
              <div className="amount-hero">
                <span className="amount-label">Amount Payable</span>
                <h1 className="amount-value">{formattedAmount}</h1>
                <div className="purpose-chip">
                  <Zap size={11} color="var(--primary)" />
                  <span>{transaction?.metadata?.purpose || 'Rent Payment'}</span>
                </div>
              </div>

              {/* Resident Details */}
              <div className="glass-card-sm">
                <div className="detail-header">
                  <div className="status-dot"></div>
                  <span className="verified-label">Resident Verified</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Resident Name</span>
                  <span className="detail-val">{transaction?.metadata?.resident_name}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Room / Cot No</span>
                  <span className="detail-val">{transaction?.metadata?.room_number || 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Mobile Number</span>
                  <span className="detail-val">{transaction?.metadata?.resident_phone}</span>
                </div>
              </div>

              {/* Invoice Breakdown */}
              <div className="glass-card-sm" style={{ border: 'none', background: 'transparent', padding: '0 4px' }}>
                <span className="invoice-title">Invoice Details</span>
                <div className="detail-row">
                  <span className="detail-key">{transaction?.metadata?.purpose || 'Rent Payment'}</span>
                  <span className="detail-val">{formattedAmount}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-key">Gateway & Processing Fee</span>
                  <span className="detail-val free-badge">FREE (₹0)</span>
                </div>
                <div className="invoice-total">
                  <span className="invoice-total-label">Total Amount Payable</span>
                  <span className="invoice-total-value">{formattedAmount}</span>
                </div>
              </div>

              {/* Checkout Button */}
              <button className="pay-btn" onClick={handlePayment} disabled={verifying || timeLeft <= 0}>
                {verifying ? (
                  <>
                    <div className="pay-btn-spinner"></div>
                    <span>Processing Secure Checkout...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={14} />
                    <span>Pay {formattedAmount} via Secure Gateway</span>
                  </>
                )}
              </button>

              <div className="methods-row">
                <p>Supports UPI, Cards, Netbanking & Wallets</p>
              </div>

              <div className="security-seal">
                <ShieldCheck size={12} color="var(--text-muted)" />
                <span>Protected by Razorpay PCI-DSS Level 1 Security</span>
              </div>
            </>
          )}
        </div>

        {/* Simple Web App FAQ section */}
        <div className="faq-section">
          <span className="faq-section-label">Frequently Asked Questions</span>
          
          <div className={`faq-item ${faqOpen === 1 ? 'open' : ''}`} onClick={() => setFaqOpen(faqOpen === 1 ? null : 1)}>
            <div className="faq-question">
              <span className="faq-q-text">Is my payment secure?</span>
              <ChevronDown size={12} className="faq-chevron" />
            </div>
            {faqOpen === 1 && (
              <div className="faq-answer">
                Yes. Your transaction is directly processed through Razorpay's PCI-DSS compliant secure servers. Nestora never stores or views your card, UPI PIN, or netbanking credentials.
              </div>
            )}
          </div>

          <div className={`faq-item ${faqOpen === 2 ? 'open' : ''}`} onClick={() => setFaqOpen(faqOpen === 2 ? null : 2)}>
            <div className="faq-question">
              <span className="faq-q-text">How long does verification take?</span>
              <ChevronDown size={12} className="faq-chevron" />
            </div>
            {faqOpen === 2 && (
              <div className="faq-answer">
                Verification happens instantly. Once you complete the payment on the Razorpay gateway, this page will auto-update to show your receipt. Your property manager receives a real-time notification immediately.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="footer">
          <p>© {new Date().getFullYear()} Nestora. All rights reserved.</p>
          <p style={{ marginTop: 4 }}>Powered by Nestora SaaS — Simplifying Property Management.</p>
        </div>

      </div>
    </div>
  );
}
