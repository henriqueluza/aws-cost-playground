import { z } from 'zod';
import { AuthError } from './authError';

/** URL absoluta `https` sem credenciais, query nem fragmento. */
const endpointUrl = z.url({ protocol: /^https$/ }).refine((value) => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
});

/** Documento de descoberta OIDC (só o que se usa; campos a mais são ignorados). */
const discoverySchema = z.object({
  issuer: z.string().min(1).max(512),
  authorization_endpoint: endpointUrl,
  token_endpoint: endpointUrl,
  revocation_endpoint: endpointUrl.optional(),
  end_session_endpoint: endpointUrl.optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
});

/** Endpoints do servidor de autorização, todos `https` e da mesma origem. */
export type Endpoints = {
  readonly signIn: string;
  readonly signUp: string;
  readonly forgotPassword: string;
  readonly token: string;
  readonly revoke: string;
  readonly logout: string;
};

/** De onde o site foi aberto e se as exceções do servidor de desenvolvimento valem. */
export type LoginSite = {
  /** Origem da página (`location.origin`), injetada por quem chama: o modelo não lê `window`. */
  readonly siteOrigin: string;
  /** Só `true` no servidor de desenvolvimento: aceita o login em `localhost` com o site em `localhost`. */
  readonly allowLocalhost?: boolean;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
/** O `URL` já entrega minúsculas, punycode e IPv4 em decimal; falta só o ponto final do FQDN. */
const hostOf = (url: URL) => url.hostname.replace(/\.$/, '');
const isIpLiteral = (host: string) => host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host);

/**
 * O login gerenciado de um site é sempre `https://auth.<host do site>`, na porta padrão: produção
 * é `auth.<domínio>` e staging, `auth.staging.<domínio>` (`infra/modules/dns`). A comparação é de
 * host inteiro, depois de normalizado pelo `URL`: sufixo, prefixo ou porta diferentes não passam.
 * Site aberto por IP não tem login gerenciado.
 */
export function isLoginOfSite(authorizationEndpoint: string, site: LoginSite): boolean {
  let login: URL;
  let page: URL;
  try {
    login = new URL(authorizationEndpoint);
    page = new URL(site.siteOrigin);
  } catch {
    return false;
  }
  if (login.protocol !== 'https:' || login.username !== '' || login.password !== '') return false;
  if (page.protocol !== 'https:' && page.protocol !== 'http:') return false;
  const loginHost = hostOf(login);
  const siteHost = hostOf(page);
  if (site.allowLocalhost === true && LOCAL_HOSTS.has(siteHost) && LOCAL_HOSTS.has(loginHost)) {
    return true;
  }
  if (login.port !== '' || siteHost === '' || isIpLiteral(siteHost)) return false;
  return loginHost === `auth.${siteHost}`;
}

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '');

/** Caminho de descoberta, resolvido a partir do emissor do `/config.json` (nunca de uma query). */
export function discoveryUrl(authority: string): string {
  return `${withoutTrailingSlash(authority)}/.well-known/openid-configuration`;
}

/**
 * Valida o documento de descoberta contra o emissor esperado e devolve os endpoints. O `issuer` do
 * documento tem de ser o emissor da configuração, o endpoint de autorização tem de ser o login
 * gerenciado deste site (`isLoginOfSite`; senão, `AuthError('login-origin')`) e todo endpoint tem
 * de ser `https` e da mesma origem dele: um documento que aponte outra origem é recusado. O Cognito
 * pode não listar revogação e logout; nesse caso saem da origem validada (`/oauth2/revoke`,
 * `/logout`), assim como as telas `/signup` e `/forgotPassword` do login gerenciado.
 */
export function parseEndpoints(raw: unknown, authority: string, site: LoginSite): Endpoints {
  const parsed = discoverySchema.safeParse(raw);
  if (!parsed.success) throw new AuthError('invalid-response');
  const doc = parsed.data;
  if (withoutTrailingSlash(doc.issuer) !== withoutTrailingSlash(authority)) {
    throw new AuthError('invalid-response');
  }
  const methods = doc.code_challenge_methods_supported;
  if (methods && !methods.includes('S256')) throw new AuthError('invalid-response');
  if (!isLoginOfSite(doc.authorization_endpoint, site)) throw new AuthError('login-origin');
  const origin = new URL(doc.authorization_endpoint).origin;
  const listed = [doc.token_endpoint, doc.revocation_endpoint, doc.end_session_endpoint];
  if (listed.some((value) => value !== undefined && new URL(value).origin !== origin)) {
    throw new AuthError('invalid-response');
  }
  return {
    signIn: doc.authorization_endpoint,
    signUp: `${origin}/signup`,
    forgotPassword: `${origin}/forgotPassword`,
    token: doc.token_endpoint,
    revoke: doc.revocation_endpoint ?? `${origin}/oauth2/revoke`,
    logout: doc.end_session_endpoint ?? `${origin}/logout`,
  };
}
