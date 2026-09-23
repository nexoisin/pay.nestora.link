/// <reference types="vite/client" />

interface CashfreeCheckoutOptions {
  paymentSessionId: string;
  redirectTarget?: '_self' | '_blank' | '_top' | '_modal';
}

interface CashfreeInstance {
  checkout: (options: CashfreeCheckoutOptions) => Promise<any>;
}

interface Window {
  Cashfree?: (options: { mode: 'sandbox' | 'production' }) => CashfreeInstance;
}
