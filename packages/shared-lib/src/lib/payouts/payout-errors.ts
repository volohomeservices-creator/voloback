export class ProviderNotConfiguredError extends Error {
  constructor(providerName: string) {
    super(`Provider ${providerName} is not configured or enabled.`);
    this.name = 'ProviderNotConfiguredError';
  }
}

export class PayoutExecutionError extends Error {
  constructor(message: string, public readonly originalError?: any) {
    super(message);
    this.name = 'PayoutExecutionError';
  }
}
