import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/lib/api';
import { deleteAccount, type DeleteAccountDeps } from './deleteAccount';

function deps(overrides: Partial<DeleteAccountDeps> = {}) {
  const calls: string[] = [];
  const step = (name: string) => vi.fn(() => void calls.push(name));
  const all: DeleteAccountDeps = {
    remove: vi.fn(() => {
      calls.push('remove');
      return Promise.resolve();
    }),
    discardDraft: step('discardDraft'),
    forgetSavedDesign: step('forgetSavedDesign'),
    leave: vi.fn(() => {
      calls.push('leave');
    }),
    clearCache: step('clearCache'),
    signOut: vi.fn(() => {
      calls.push('signOut');
      return Promise.resolve();
    }),
    ...overrides,
  };
  return { all, calls };
}

describe('deleteAccount', () => {
  it('apaga, sai da página e só então encerra a sessão', async () => {
    const { all, calls } = deps();
    await deleteAccount(all);
    expect(calls).toEqual([
      'remove',
      'discardDraft',
      'forgetSavedDesign',
      'leave',
      'clearCache',
      'signOut',
    ]);
  });

  it('se a API falha, nada local é tocado e o erro sobe', async () => {
    const error = new ApiError({ kind: 'network' });
    const { all, calls } = deps({ remove: vi.fn(() => Promise.reject(error)) });
    await expect(deleteAccount(all)).rejects.toBe(error);
    expect(calls).toEqual([]);
  });

  it('depois do 204, um passo que falha não impede o encerramento da sessão nem vira erro', async () => {
    const boom = () => {
      throw new Error('falha local');
    };
    const { all, calls } = deps({ leave: boom, clearCache: boom, discardDraft: boom });
    await expect(deleteAccount(all)).resolves.toBeUndefined();
    expect(calls).toContain('signOut');
  });
});
