import { describe, expect, it } from 'vitest';
import { AuthError } from './authError';
import { isLoginOfSite, parseEndpoints } from './endpoints';

const PRODUCTION = 'https://exemplo.com';
const STAGING = 'https://staging.exemplo.com';
const at = (siteOrigin: string, allowLocalhost = false) => ({ siteOrigin, allowLocalhost });

describe('isLoginOfSite', () => {
  it.each([
    ['produção', 'https://auth.exemplo.com/oauth2/authorize', PRODUCTION],
    ['staging', 'https://auth.staging.exemplo.com/oauth2/authorize', STAGING],
    ['maiúsculas no host e no esquema', 'HTTPS://AUTH.Exemplo.COM/oauth2/authorize', PRODUCTION],
    ['porta 443 explícita', 'https://auth.exemplo.com:443/oauth2/authorize', PRODUCTION],
    ['ponto final do FQDN', 'https://auth.exemplo.com./oauth2/authorize', PRODUCTION],
    ['site com ponto final', 'https://auth.exemplo.com/oauth2/authorize', 'https://exemplo.com.'],
    ['IDN contra punycode', 'https://auth.xn--exmplo-jva.com/a', 'https://exêmplo.com'],
    ['site em localhost no build de produção', 'https://auth.localhost/a', 'http://localhost:4173'],
  ])('aceita: %s', (_name, endpoint, siteOrigin) => {
    expect(isLoginOfSite(endpoint, at(siteOrigin))).toBe(true);
  });

  it.each([
    ['sufixo de outro domínio', 'https://auth.exemplo.com.atacante.net/a', PRODUCTION],
    ['prefixo colado', 'https://xauth.exemplo.com/a', PRODUCTION],
    ['subdomínio a mais', 'https://x.auth.exemplo.com/a', PRODUCTION],
    ['porta fora do padrão', 'https://auth.exemplo.com:8443/a', PRODUCTION],
    ['userinfo com o host esperado', 'https://auth.exemplo.com@atacante.net/a', PRODUCTION],
    ['userinfo no host certo', 'https://usuario:senha@auth.exemplo.com/a', PRODUCTION],
    ['esquema http', 'http://auth.exemplo.com/a', PRODUCTION],
    ['o próprio site', 'https://exemplo.com/a', PRODUCTION],
    ['login de produção no staging', 'https://auth.exemplo.com/a', STAGING],
    ['login de staging na produção', 'https://auth.staging.exemplo.com/a', PRODUCTION],
    ['IP literal', 'https://203.0.113.7/a', PRODUCTION],
    ['IPv6 literal', 'https://[2001:db8::1]/a', PRODUCTION],
    ['homógrafo (e cirílico)', 'https://auth.\u0435xemplo.com/a', PRODUCTION],
    ['barra invertida antes do host', 'https://atacante.net\\@auth.exemplo.com/a', PRODUCTION],
    ['localhost fora de desenvolvimento', 'https://localhost:9229/a', 'http://localhost:5173'],
    ['127.0.0.1 fora de desenvolvimento', 'https://127.0.0.1/a', 'http://127.0.0.1:5173'],
    ['site aberto por IP', 'https://auth.203.0.113.7/a', 'https://203.0.113.7'],
    ['site aberto por IPv6', 'https://auth.exemplo.com/a', 'https://[::1]'],
    ['origem do site opaca', 'https://auth.exemplo.com/a', 'null'],
    ['origem do site fora de http(s)', 'https://auth.exemplo.com/a', 'file:///exemplo.com'],
    ['endpoint que não é URL', 'auth.exemplo.com', PRODUCTION],
  ])('recusa: %s', (_name, endpoint, siteOrigin) => {
    expect(isLoginOfSite(endpoint, at(siteOrigin))).toBe(false);
  });

  it('em desenvolvimento, localhost só vale com o site também em localhost', () => {
    expect(isLoginOfSite('https://localhost:9229/a', at('http://localhost:5173', true))).toBe(true);
    expect(isLoginOfSite('https://127.0.0.1:9229/a', at('http://localhost:5173', true))).toBe(true);
    expect(isLoginOfSite('http://localhost:9229/a', at('http://localhost:5173', true))).toBe(false);
    expect(isLoginOfSite('https://localhost.atacante.net/a', at('http://localhost', true))).toBe(
      false,
    );
    expect(isLoginOfSite('https://atacante.net/a', at('http://localhost:5173', true))).toBe(false);
    expect(isLoginOfSite('https://localhost/a', at(PRODUCTION, true))).toBe(false);
    expect(isLoginOfSite('https://auth.exemplo.com/a', at(PRODUCTION, true))).toBe(true);
  });
});

describe('parseEndpoints', () => {
  const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Teste';
  const doc = (origin: string) => ({
    issuer,
    authorization_endpoint: `${origin}/oauth2/authorize`,
    token_endpoint: `${origin}/oauth2/token`,
  });

  it('prende token, revogação, logout e as telas à origem do login deste site', () => {
    const origin = 'https://auth.staging.exemplo.com';
    expect(parseEndpoints(doc(origin), issuer, at(STAGING))).toEqual({
      signIn: `${origin}/oauth2/authorize`,
      signUp: `${origin}/signup`,
      forgotPassword: `${origin}/forgotPassword`,
      token: `${origin}/oauth2/token`,
      revoke: `${origin}/oauth2/revoke`,
      logout: `${origin}/logout`,
    });
  });

  it('login de outro site é erro próprio, e a mensagem não carrega a URL recusada', () => {
    const attempt = () => parseEndpoints(doc('https://auth.atacante.net'), issuer, at(STAGING));
    expect(attempt).toThrow(AuthError);
    expect(attempt).toThrow('Erro de autenticação: login-origin.');
  });

  it('token fora da origem do login continua recusado', () => {
    const mixed = { ...doc('https://auth.exemplo.com'), token_endpoint: 'https://atacante.net/t' };
    expect(() => parseEndpoints(mixed, issuer, at(PRODUCTION))).toThrow(
      'Erro de autenticação: invalid-response.',
    );
  });
});
