export class ReceiptProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "ReceiptProviderError";
  }
}

export function isRetryableHttpStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}
