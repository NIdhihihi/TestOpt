import { signPayload, verifySignature } from '../utils/crypto.js';
import { calculateSubtotal } from '../catalog/pricing.js';

const RECEIPT_SIGNING_KEY = 'receipt-signing-secret-key-2026';

export function generateReceipt(order) {
  if (!order || !order.orderId || !order.customer) {
    throw new Error('Invalid order object for receipt generation');
  }

  const items = order.items || [];
  const itemCount = items.reduce((sum, i) => sum + (i.quantity || 1), 0);
  const subtotal = calculateSubtotal(items);
  const total = order.pricing?.total ?? subtotal;

  const receiptBody = {
    receiptId: `rcpt_${order.orderId}`,
    orderId: order.orderId,
    customerEmail: order.customer.email,
    itemCount,
    total,
    currency: 'USD',
    issuedAt: new Date().toISOString(),
  };

  const { signature } = signPayload(receiptBody, RECEIPT_SIGNING_KEY);

  return {
    ...receiptBody,
    signature,
    summaryText: `Order #${order.orderId}: ${itemCount} item(s) totaling $${total.toFixed(2)} sent to ${order.customer.email}`,
  };
}

export function verifyReceipt(receipt) {
  if (!receipt || !receipt.signature) return false;
  const { signature, summaryText, ...payload } = receipt;
  return verifySignature(payload, signature, RECEIPT_SIGNING_KEY);
}

