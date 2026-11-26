import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button, Dialog, Notice } from '../../../shared/ui';
import type { AuthScreen } from '../application/ports';
import type { AuthErrorKind } from '../model/authError';
import { authErrorKind, authMessage } from '../model/authMessages';
import styles from './AuthActions.module.css';
import { useAuth } from './AuthProvider';

/** Voltar do login pelo botão do navegador restaura a página do cache: os botões não podem ficar travados. */
function usePageRestored(onRestore: () => void) {
  useEffect(() => {
    const handler = (event: PageTransitionEvent) => {
      if (event.persisted) onRestore();
    };
    window.addEventListener('pageshow', handler);
    return () => window.removeEventListener('pageshow', handler);
  }, [onRestore]);
}

/**
 * Leva ao login gerenciado voltando à página de agora (o destino passa por `safeReturnTo` no
 * serviço). `beforeSignIn` guarda o que a página tem de sobreviver à saída do site. Um pedido por vez.
 */
function useSignIn(beforeSignIn?: () => void) {
  const { service } = useAuth();
  const { pathname, search } = useLocation();
  const [busy, setBusy] = useState<AuthScreen | null>(null);
  const [failure, setFailure] = useState<AuthErrorKind | null>(null);
  const last = useRef<AuthScreen>('sign-in');
  usePageRestored(() => {
    setBusy(null);
    setFailure(null);
  });

  function go(screen: AuthScreen) {
    if (busy !== null) return;
    last.current = screen;
    setFailure(null);
    setBusy(screen);
    beforeSignIn?.();
    service.signIn({ screen, returnTo: `${pathname}${search}` }).catch((error: unknown) => {
      setFailure(authErrorKind(error));
      setBusy(null);
    });
  }

  const dialog = (
    <Dialog
      open={failure !== null}
      onClose={() => setFailure(null)}
      title="Não foi possível abrir o login"
    >
      {failure !== null && <Notice tone="negative" message={authMessage(failure)} />}
      <div className={styles.dialogActions}>
        <Button onClick={() => setFailure(null)}>Fechar</Button>
        <Button variant="primary" onClick={() => go(last.current)}>
          Tentar de novo
        </Button>
      </div>
    </Dialog>
  );
  return { go, busy, dialog };
}

/** O "Entrar" que outras features recebem como ação (ex.: o aviso de salvar, a lista de designs). */
export function SignInButton({ beforeSignIn }: { beforeSignIn?: () => void }) {
  const { go, busy, dialog } = useSignIn(beforeSignIn);
  return (
    <>
      <Button variant="primary" onClick={() => go('sign-in')} aria-disabled={busy !== null}>
        {busy === null ? 'Entrar' : 'Abrindo…'}
      </Button>
      {dialog}
    </>
  );
}

/**
 * Conta na barra de ações do editor. Anônimo: Entrar e Criar conta (a recuperação de senha está na
 * tela do login gerenciado). Com sessão: o e-mail leva à conta e Sair encerra a sessão.
 */
export function AuthActions({ beforeSignIn }: { beforeSignIn?: () => void }) {
  const { service, snapshot } = useAuth();
  const { go, busy, dialog } = useSignIn(beforeSignIn);
  const [leaving, setLeaving] = useState(false);
  usePageRestored(() => setLeaving(false));

  if (snapshot.status === 'authenticated') {
    const { email } = snapshot.user;
    return (
      <div className={styles.group}>
        <Link
          to="/conta"
          className={styles.who}
          title={email ?? undefined}
          aria-label={email === null ? 'Conta' : `Conta de ${email}`}
        >
          {email ?? 'Conta'}
        </Link>
        <Button
          variant="tertiary"
          aria-disabled={leaving}
          onClick={() => {
            if (leaving) return;
            setLeaving(true);
            void service.signOut();
          }}
        >
          {leaving ? 'Saindo…' : 'Sair'}
        </Button>
        <span role="status" className={styles.hidden}>
          {leaving ? 'Saindo da conta…' : ''}
        </span>
      </div>
    );
  }
  return (
    <div className={styles.group}>
      <Button aria-disabled={busy !== null} onClick={() => go('sign-in')}>
        {busy === 'sign-in' ? 'Abrindo…' : 'Entrar'}
      </Button>
      <Button variant="tertiary" aria-disabled={busy !== null} onClick={() => go('sign-up')}>
        {busy === 'sign-up' ? 'Abrindo…' : 'Criar conta'}
      </Button>
      <span role="status" className={styles.hidden}>
        {busy !== null ? 'Abrindo o login…' : ''}
      </span>
      {dialog}
    </div>
  );
}
