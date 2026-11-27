import type { RuntimeConfig } from '../../../shared/config';
import { createAuthService } from '../application/authService';
import type { AuthService } from '../application/ports';
import { createCognitoProvider } from './cognitoProvider';
import { createMemorySessionStore } from './memorySessionStore';
import { createSessionAttemptStore } from './sessionAttemptStore';

/**
 * O serviço de sessão do navegador: Cognito (emissor e client id do `/config.json` validado),
 * tokens só em memória, tentativa de login em `sessionStorage`. `redirect_uri` e `logout_uri`
 * saem da origem da própria página e são os registrados no cliente do Cognito. O login gerenciado
 * tem de ser `auth.` + o host da página (`localhost` só no servidor de desenvolvimento). Só navega para
 * `https` ou para a própria origem. Criar o serviço não faz nenhuma chamada de rede.
 */
export function createBrowserAuth(config: RuntimeConfig, location: Location): AuthService {
  const { origin } = location;
  return createAuthService({
    provider: createCognitoProvider({
      authority: config.cognitoAuthority,
      clientId: config.cognitoClientId,
      redirectUri: `${origin}/auth/callback`,
      logoutUri: `${origin}/`,
      site: { siteOrigin: origin, allowLocalhost: import.meta.env.DEV },
      attempts: createSessionAttemptStore(),
    }),
    store: createMemorySessionStore(),
    signUpAvailable: config.selfSignupEnabled,
    navigate(url) {
      const target = new URL(url, origin);
      if (target.protocol === 'https:' || target.origin === origin) location.assign(target.href);
    },
  });
}
