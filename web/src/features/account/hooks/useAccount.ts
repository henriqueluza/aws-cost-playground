import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useApi } from '../../../shared/lib/api/ApiProvider';
import { forgetSavedDesign } from '../../designs';
import { discardDesignDraft } from '../../editor';
import { useAuth } from '../../auth';
import { deleteAccount } from '../application/deleteAccount';

/** Chave sem dado do usuário; o cache todo é descartado ao trocar de sessão (`app/sessionCache`). */
export const accountKeys = { quota: ['account', 'quota'] as const };

/** Quota de estimativas, lida sem consumir. `retry: false`: o usuário tem "Tentar de novo". */
export function useQuota() {
  const api = useApi();
  return useQuery({ queryKey: accountKeys.quota, queryFn: () => api.quota.get(), retry: false });
}

/** Exclui a conta e encerra a sessão. Sem `retry`: repetir é escolha do usuário. */
export function useDeleteAccount() {
  const api = useApi();
  const { service } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      deleteAccount({
        remove: () => api.account.deleteAccount(),
        // `flushSync`: a página da conta sai do DOM antes de a sessão cair; senão a rota protegida
        // veria o anônimo e levaria ao login de novo. Vale com o `RouterProvider` de
        // `react-router/dom`, o do `bootstrap`.
        leave: () => navigate('/', { replace: true, flushSync: true }),
        discardDraft: () => discardDesignDraft(),
        forgetSavedDesign,
        clearCache: () => queryClient.clear(),
        signOut: () => service.signOut(),
      }),
    retry: false,
  });
}
