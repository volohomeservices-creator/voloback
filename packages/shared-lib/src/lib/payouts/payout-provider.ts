import { ProviderNotConfiguredError } from './payout-errors';

export interface PayoutProvider {
  createContact(workerId: string, name: string, email: string, phone: string): Promise<string>;
  createFundAccount(contactId: string, bankAccountDetails: any): Promise<string>;
  createPayout(fundAccountId: string, amount: number, referenceId: string): Promise<{ providerPayoutId: string, status: string }>;
  fetchPayoutStatus(providerPayoutId: string): Promise<{ status: string, utr: string | null, failureReason: string | null }>;
  verifyBankAccount(bankAccountDetails: any): Promise<boolean>;
}

export class DefaultPayoutProvider implements PayoutProvider {
  private isMockMode(): boolean {
    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER;
    return !keyId || !keySecret || !accountNumber || keyId === '' || keySecret === '' || accountNumber === '';
  }

  async createContact(workerId: string, name: string, email: string, phone: string): Promise<string> {
    if (this.isMockMode()) {
      console.log(`[Mock Payout Provider] Creating contact for worker: ${workerId}`);
      return `cont_mock_${Math.random().toString(36).substring(2, 10)}`;
    }
    throw new ProviderNotConfiguredError('DEFAULT_RAZORPAYX');
  }

  async createFundAccount(contactId: string, bankAccountDetails: any): Promise<string> {
    if (this.isMockMode()) {
      console.log(`[Mock Payout Provider] Creating fund account for contact: ${contactId}`);
      return `fa_mock_${Math.random().toString(36).substring(2, 10)}`;
    }
    throw new ProviderNotConfiguredError('DEFAULT_RAZORPAYX');
  }

  async createPayout(fundAccountId: string, amount: number, referenceId: string): Promise<{ providerPayoutId: string, status: string }> {
    if (this.isMockMode()) {
      console.log(`[Mock Payout Provider] Creating payout of ${amount} for fund account: ${fundAccountId}`);
      return {
        providerPayoutId: `pout_mock_${Math.random().toString(36).substring(2, 10)}`,
        status: 'processing'
      };
    }
    throw new ProviderNotConfiguredError('DEFAULT_RAZORPAYX');
  }

  async fetchPayoutStatus(providerPayoutId: string): Promise<{ status: string, utr: string | null, failureReason: string | null }> {
    if (this.isMockMode()) {
      console.log(`[Mock Payout Provider] Fetching status for payout: ${providerPayoutId}`);
      return {
        status: 'processed',
        utr: `utr_mock_${Math.random().toString(36).substring(2, 10)}`,
        failureReason: null
      };
    }
    throw new ProviderNotConfiguredError('DEFAULT_RAZORPAYX');
  }

  async verifyBankAccount(bankAccountDetails: any): Promise<boolean> {
    if (this.isMockMode()) {
      console.log('[Mock Payout Provider] Verifying bank account (always returns true in mock mode)');
      return true;
    }
    throw new ProviderNotConfiguredError('DEFAULT_RAZORPAYX');
  }
}
