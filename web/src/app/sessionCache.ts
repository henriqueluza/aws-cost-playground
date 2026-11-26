import type { QueryClient } from '@tanstack/react-query';
import type { AuthService } from '../features/auth';

/**
 * Os dados em cache são do usuário da sessão: a chave de uma consulta não leva o usuário. Ao
 * entrar, sair ou trocar de usuário (inclusive pelo fim da sessão em `signOut`, que a conta
 * excluída também usa), o cache inteiro é descartado, para o próximo usuário do mesmo navegador
 * nunca ver, nem por um instante, o que era do anterior. Devolve a função que cancela.
 */
export function clearCacheOnUserChange(auth: AuthService, queryClient: QueryClient): () => void {
  const who = () => {
    const snapshot = auth.getSnapshot();
    return snapshot.status === 'authenticated' ? snapshot.user.sub : null;
  };
  let current = who();
  return auth.subscribe(() => {
    const next = who();
    if (next === current) return;
    current = next;
    queryClient.clear();
  });
}
