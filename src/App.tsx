import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Receipt,
  AlertCircle,
  RefreshCw,
  Sun,
  Moon,
  ArrowLeft,
  CreditCard,
  Building2,
  CheckCircle2,
  Home
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

export function App() {
  const [transaction, setTransaction] = useState<(TransactionSession & { razorpay_key_id?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(86400);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<'card' | 'bank'>('card');

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

  const copyPaymentToken = () => {
    if (!transaction) return;
    navigator.clipboard.writeText(transaction.payment_token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <button className="sticky-pay-btn" onClick={() => window.location.reload()} style={{ padding: '12px 24px' }}>
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

  return (
    <div className="page-wrapper">
      <div className="page-container">

        {/* Top Sample Navigation Header */}
        <div className="sample-header">
          <div className="sample-back-btn" onClick={() => window.history.back()}>
            <ArrowLeft size={16} color="var(--text-primary)" />
          </div>
          <h1 className="sample-title">{isPaid ? 'Order Details' : 'Payment Method'}</h1>
          <div className="sample-icon-btn" onClick={() => setIsDarkMode(!isDarkMode)}>
            {isDarkMode ? <Sun size={16} color="var(--text-primary)" /> : <Moon size={16} color="var(--text-primary)" />}
          </div>
        </div>

        {isPaid ? (
          /* SAMPLE SCREEN 2: PAYMENT SUCCESSFUL VIEW */
          <>
            <div className="sample-card" style={{ textAlign: 'center', padding: '28px 20px' }}>
              <div style={{
                width: 68, height: 68, borderRadius: '50%',
                background: 'var(--success-light)', border: '1px solid var(--success-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px'
              }}>
                <CheckCircle2 size={36} color="var(--success)" style={{ margin: 'auto' }} />
              </div>

              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Payment Successful</h2>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 20 }}>
                Your rent payment has been received and confirmed. Link is now closed.
              </p>

              {/* Payment Details Table matching Sample */}
              <span className="section-label" style={{ textAlign: 'left' }}>Payment Details</span>
              <div style={{ background: 'var(--card-dark-bg)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                <div className="detail-table-row">
                  <span className="detail-table-key">Transaction ID</span>
                  <span className="detail-table-val">{transaction?.payment_token?.substring(0, 12)}...</span>
                </div>
                <div className="detail-table-row">
                  <span className="detail-table-key">Date</span>
                  <span className="detail-table-val">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                <div className="detail-table-row">
                  <span className="detail-table-key">Type of Transaction</span>
                  <span className="detail-table-val">Razorpay Gateway</span>
                </div>
                <div className="detail-table-row">
                  <span className="detail-table-key">Total</span>
                  <span className="detail-table-val" style={{ color: 'var(--primary)', fontWeight: 900 }}>{formattedAmount}</span>
                </div>
                <div className="detail-table-row">
                  <span className="detail-table-key">Status</span>
                  <span className="status-badge-green">
                    <CheckCircle2 size={12} /> Success
                  </span>
                </div>
              </div>
            </div>

            <button className="sticky-pay-btn" onClick={() => window.print()} style={{ width: '100%', justifyContent: 'center', borderRadius: '16px' }}>
              <Receipt size={16} />
              Download Receipt
            </button>
          </>
        ) : (
          /* SAMPLE SCREEN 1: CHECKOUT VIEW */
          <>
            {/* Card 1: Product / Merchant Card matching Sample */}
            <div className="sample-card">
              <div className="merchant-item-row">
                {transaction?.metadata?.property_logo ? (
                  <img src={transaction.metadata.property_logo} alt="property" className="merchant-item-img" />
                ) : (
                  <div className="merchant-item-placeholder">
                    {transaction?.metadata?.property_name?.charAt(0) || 'H'}
                  </div>
                )}
                <div className="merchant-item-info">
                  <h2 className="merchant-item-title">{transaction?.metadata?.property_name || 'Good Shepherd Mens PG'}</h2>
                  <p className="merchant-item-desc">{transaction?.metadata?.purpose || 'Hostel Rent Payment'} · Verified Partner</p>
                  <span className="merchant-item-price">{formattedAmount}</span>
                </div>
              </div>
            </div>

            {/* Card 2: Deliver To / Resident Details matching Sample */}
            <div className="sample-card">
              <span className="section-label">Resident Details</span>
              <div className="resident-delivery-card">
                <div className="resident-delivery-info">
                  <h3 className="resident-delivery-name">{transaction?.metadata?.resident_name || 'Resident'}</h3>
                  <p className="resident-delivery-sub">
                    {transaction?.metadata?.room_number || 'Room N/A'} · {transaction?.metadata?.resident_phone || 'Mobile N/A'}
                  </p>
                </div>
                <div className="resident-map-badge">
                  <Home size={16} />
                  <span>ROOM</span>
                </div>
              </div>
            </div>

            {/* Card 3: Payment Method Options Grid matching Sample */}
            <div className="sample-card">
              <span className="section-label">Payment Method</span>
              <div className="payment-methods-grid">
                <div
                  className={`method-card ${selectedMethod === 'card' ? 'selected' : ''}`}
                  onClick={() => setSelectedMethod('card')}
                >
                  <div className="method-card-header">
                    <CreditCard size={15} color={selectedMethod === 'card' ? 'var(--primary)' : 'var(--text-secondary)'} />
                    <span className="method-card-title">Cards / UPI</span>
                  </div>
                  <p className="method-card-desc">Pay securely using credit/debit card, UPI or Netbanking.</p>
                </div>

                <div
                  className={`method-card ${selectedMethod === 'bank' ? 'selected' : ''}`}
                  onClick={() => setSelectedMethod('bank')}
                >
                  <div className="method-card-header">
                    <Building2 size={15} color={selectedMethod === 'bank' ? 'var(--primary)' : 'var(--text-secondary)'} />
                    <span className="method-card-title">Bank Transfer</span>
                  </div>
                  <p className="method-card-desc">Transfer money directly to your hostel account.</p>
                </div>
              </div>
            </div>

            {/* Floating Sticky Bottom Bar matching Sample UI */}
            <div className="sticky-bottom-bar">
              <div className="sticky-bottom-container">
                <div className="sticky-price-col">
                  <span className="sticky-price-label">Total Payable</span>
                  <span className="sticky-price-val">{formattedAmount}</span>
                </div>
                <button
                  className="sticky-pay-btn"
                  onClick={handlePayment}
                  disabled={verifying || timeLeft <= 0}
                >
                  {verifying ? 'Processing...' : 'Pay Now'}
                </button>
              </div>
            </div>
          </>
        )}

        <div className="footer">
          <p>© {new Date().getFullYear()} Nestora SaaS. All rights reserved.</p>
          <p style={{ marginTop: 4 }}>Secured by Razorpay PCI-DSS Level 1 Encryption.</p>
        </div>

      </div>
    </div>
  );
}
