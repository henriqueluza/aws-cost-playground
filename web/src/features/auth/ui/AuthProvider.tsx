import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthService, AuthSnapshot } from '../application/ports';

const AuthContext = createContext<AuthService | null>(null);

/** Entrega o serviço de sessão (criado no `bootstrap`) à árvore. A interface lê quem é o usuário e entra ou sai; o token de acesso é só do transporte HTTP, ligado no `bootstrap`: nenhum componente chama `getAccessToken`. */
export function AuthProvider({ service, children }: { service: AuthService; children: ReactNode }) {
  return <AuthContext.Provider value={service}>{children}</AuthContext.Provider>;
}

/** O serviço e o que a interface vê da sessão (quem é, nunca os tokens). Re-renderiza a cada mudança. */
export function useAuth(): { service: AuthService; snapshot: AuthSnapshot } {
  const service = useContext(AuthContext);
  if (service === null) throw new Error('useAuth fora do AuthProvider.');
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  return { service, snapshot };
}
