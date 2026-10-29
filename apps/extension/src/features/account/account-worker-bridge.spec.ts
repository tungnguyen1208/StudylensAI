import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_REQUEST_MESSAGE, accountBridge } from './account-worker-bridge';

describe('account worker bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['status', 'signOut', 'quota'] as const)(
    'sends only the account operation for %s',
    async (operation) => {
      const sendMessage = vi.fn().mockResolvedValue({ authenticated: operation !== 'signOut' });
      vi.stubGlobal('chrome', { runtime: { sendMessage } });

      const response = await accountBridge[operation]();

      expect(sendMessage).toHaveBeenCalledWith({ type: ACCOUNT_REQUEST_MESSAGE, operation });
      expect(Object.keys(sendMessage.mock.calls[0][0]).sort()).toEqual(['operation', 'type']);
      expect(response.authenticated).toBe(operation !== 'signOut');
    },
  );

  it('sends local credentials only to the service worker', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ authenticated: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    await accountBridge.signIn('learner', 'long passphrase value');
    await accountBridge.register('learner', 'long passphrase value', 'Learner');
    await accountBridge.changePassword('long passphrase value', 'another long passphrase');

    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: ACCOUNT_REQUEST_MESSAGE, operation: 'signIn', username: 'learner', password: 'long passphrase value' });
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: ACCOUNT_REQUEST_MESSAGE, operation: 'register', username: 'learner', password: 'long passphrase value', displayName: 'Learner' });
    expect(sendMessage).toHaveBeenNthCalledWith(3, { type: ACCOUNT_REQUEST_MESSAGE, operation: 'changePassword', currentPassword: 'long passphrase value', newPassword: 'another long passphrase' });
  });

  it('does not expose a token when the extension runtime is unavailable', async () => {
    vi.stubGlobal('chrome', undefined);

    await expect(accountBridge.status()).resolves.toEqual({
      authenticated: false,
      error: 'extensionRuntimeUnavailable',
    });
  });
});
