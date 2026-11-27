import type { AuthUser, Session } from '../model/session';

/** Tela do login gerenciado: entrar, criar conta ou recuperar a senha. */
export type AuthScreen = 'sign-in' | 'sign-up' | 'forgot-password';

/** Resultado do retorno do login. `returnTo` saiu do armazenamento da aba e ainda não é confiável. */
export type SignInResult = { readonly session: Session; readonly returnTo: unknown };

/** Porta do provedor de identidade (login gerenciado do Cognito). Toda rejeição é um `AuthError`. */
export interface IdentityProvider {
  /**
   * Não navega. Gera `state`, `nonce` e o desafio PKCE (S256), guarda-os com `returnTo` no
   * armazenamento da aba e devolve a URL absoluta da tela pedida. Rejeita com `network` se o
   * provedor não responder.
   */
  beginSignIn(screen: AuthScreen, returnTo: string): Promise<string>;
  /**
   * `callbackUrl` é a URL inteira do retorno. Rejeita com `provider-denied` (veio `error`),
   * `callback-invalid` (falta `code` ou `state`), `state-mismatch` (`state` desconhecido; a
   * entrada é de uso único e é apagada antes da troca), `network` ou `invalid-response`.
   */
  completeSignIn(callbackUrl: string): Promise<SignInResult>;
  /**
   * Troca o refresh token por um access token novo. Pré-condição: `session.refreshToken !== null`.
   * Mantém o refresh token antigo se não vier outro. Rejeita com `session-expired` (o refresh
   * token não vale mais), `network` ou `invalid-response`.
   */
  refresh(session: Session): Promise<Session>;
  /**
   * Nunca rejeita. Revoga o refresh token (melhor esforço) e devolve a URL que encerra a sessão
   * no provedor e volta ao site; sem provedor disponível, devolve a própria URL de volta.
   */
  endSession(session: Session | null): Promise<string>;
}

/** Tentativa de login em andamento: o que atravessa o redirecionamento. Não tem token. */
export type LoginAttempt = {
  readonly state: string;
  readonly verifier: string;
  readonly nonce: string;
  /** Destino pedido; ainda não confiável (passa por `safeReturnTo` na volta). */
  readonly returnTo: string;
  readonly createdAt: number;
};

/** Guarda a tentativa na aba. Nenhum método lança. */
export interface LoginAttemptStore {
  /** `false` se não conseguiu guardar (armazenamento bloqueado). */
  save(attempt: LoginAttempt): boolean;
  /** De uso único: devolve e apaga. `null` se não há tentativa ou ela é ilegível. */
  take(): LoginAttempt | null;
}

/** Porta de onde a sessão fica guardada (hoje, só memória). Nenhum método lança. */
export interface SessionStore {
  /** Valor ausente, ilegível ou fora do schema devolve `null` e apaga o que estava guardado. */
  read(): Session | null;
  write(session: Session): void;
  clear(): void;
}

/** Navegação de página inteira (sai do site para o provedor). */
export type Navigate = (url: string) => void;

/** O que a interface enxerga da sessão: nunca os tokens. */
export type AuthSnapshot =
  { readonly status: 'anonymous' } | { readonly status: 'authenticated'; readonly user: AuthUser };

export type SignInOptions = {
  /** Padrão: `sign-in`. */
  readonly screen?: AuthScreen;
  /** Caminho interno para onde voltar; passa por `safeReturnTo`. Padrão: `/`. */
  readonly returnTo?: string;
};

/** Sessão do usuário para o resto do site. Criar o serviço não faz nenhuma chamada de rede. */
export interface AuthService {
  /** O provedor aceita cadastro pelo próprio usuário. Fechado, a interface não oferece "Criar conta". */
  readonly signUpAvailable: boolean;
  /** Referência estável enquanto a sessão não muda (serve a `useSyncExternalStore`). */
  getSnapshot(): AuthSnapshot;
  /** Avisa a cada mudança do snapshot; devolve a função que cancela. */
  subscribe(listener: () => void): () => void;
  /**
   * Leva ao login gerenciado. Com o cadastro fechado, a tela `sign-up` vira `sign-in`: o site nunca
   * monta o caminho de cadastro. Rejeita com `AuthError` se a URL não puder ser montada.
   */
  signIn(options?: SignInOptions): Promise<void>;
  /**
   * Conclui o retorno do login e devolve o caminho interno para onde voltar. A mesma
   * `callbackUrl` é processada uma única vez: chamadas repetidas recebem a mesma promise.
   * Rejeita com `AuthError`; uma falha não derruba a sessão que já existia.
   */
  completeSignIn(callbackUrl: string): Promise<string>;
  /** Limpa a sessão local e só depois navega para o encerramento no provedor. Nunca rejeita. */
  signOut(): Promise<void>;
  /**
   * Access token válido, ou `null` para o anônimo (sem tocar o provedor). Renova sob demanda, com
   * uma única renovação em voo. Rejeita com `AuthError('network')` se a renovação não tiver
   * resposta: a sessão fica como estava.
   */
  getAccessToken(): Promise<string | null>;
}

export type AuthServiceDeps = {
  readonly provider: IdentityProvider;
  readonly store: SessionStore;
  readonly navigate: Navigate;
  /** Cadastro aberto no provedor (`selfSignupEnabled` do `/config.json`). Padrão: fechado. */
  readonly signUpAvailable?: boolean;
  /** Relógio em milissegundos desde a época. Padrão: `Date.now`. */
  readonly now?: () => number;
};
