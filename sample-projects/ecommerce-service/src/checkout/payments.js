import { signPayload, verifySignature } from '../utils/crypto.js';
import { validateSessionToken } from '../auth/tokens.js';

const PAYMENT_GATEWAY_KEY = 'gateway_internal_secret_key';

export function processPayment({ userToken, amount, currency = 'USD', cardLast4 = '4242' }) {
  const session = validateSessionToken(userToken);
  if (!session) {
    return { success: false, error: 'Unauthorized payment attempt: invalid session' };
  }
  if (!amount || amount <= 0) {
    return { success: false, error: 'Invalid payment amount' };
  }

  const transactionData = {
    userId: session.userId,
    amount,
    currency,
    cardLast4,
    timestamp: Date.now(),
    gatewayRef: `tx_${Math.random().toString(36).slice(2, 10)}`,
  };

  const { signature } = signPayload(transactionData, PAYMENT_GATEWAY_KEY);
  return {
    success: true,
    transaction: transactionData,
    signature,
    receiptRef: `${transactionData.gatewayRef}-${signature.slice(0, 8)}`,
  };
}

export function verifyPaymentReceipt(transactionData, signature) {
  return verifySignature(transactionData, signature, PAYMENT_GATEWAY_KEY);
}

