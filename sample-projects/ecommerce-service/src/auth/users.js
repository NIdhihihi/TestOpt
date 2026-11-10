import { hashSecret } from '../utils/crypto.js';
import { issueSessionToken } from './tokens.js';

const userStore = new Map([
  ['alice@example.com', { id: 'u_alice', email: 'alice@example.com', passHash: hashSecret('alicePass1'), role: 'customer' }],
  ['bob@example.com', { id: 'u_bob', email: 'bob@example.com', passHash: hashSecret('bobPass2'), role: 'admin' }],
]);

export function authenticateUser(email, password) {
  const user = userStore.get(email.toLowerCase());
  if (!user) return { success: false, error: 'User not found' };
  const incomingHash = hashSecret(password);
  if (incomingHash !== user.passHash) {
    return { success: false, error: 'Invalid password' };
  }
  const session = issueSessionToken(user.id, user.role);
  return { success: true, user: { id: user.id, email: user.email, role: user.role }, session };
}

export function getUserById(id) {
  for (const user of userStore.values()) {
    if (user.id === id) {
      return { id: user.id, email: user.email, role: user.role };
    }
  }
  return null;
}

