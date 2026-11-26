import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Notice } from '../../../shared/ui';
import type { AuthService } from '../application/ports';
import { authErrorKind, authMessage } from '../model/authMessages';
import type { AuthErrorKind } from '../model/authError';
import { AuthScreen } from './AuthScreen';
import styles from './AuthScreen.module.css';
import { useAuth } from './AuthProvider';

/** Tira `code` e `state` da barra de endereço e do histórico antes de qualquer outra coisa. */
function consumeCallback(service: AuthService): Promise<string> {
  const url = window.location.href;
  window.history.replaceState(window.history.state, '', window.location.pathname);
  return service.completeSignIn(url);
}

/**
 * Retorno do login gerenciado. O `code` é aceito uma vez: a URL é limpa primeiro e a promessa fica
 * num ref, então o segundo efeito do StrictMode reaproveita a mesma troca em vez de ler uma URL já limpa.
 */
export function AuthCallbackPage() {
  const { service } = useAuth();
  const navigate = useNavigate();
  const exchange = useRef<Promise<string> | null>(null);
  const [failure, setFailure] = useState<AuthErrorKind | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    exchange.current ??= consumeCallback(service);
    let live = true;
    exchange.current.then(
      (to) => live && navigate(to, { replace: true }),
      (error: unknown) => live && setFailure(authErrorKind(error)),
    );
    return () => {
      live = false;
    };
  }, [service, navigate]);

  function retry() {
    if (retrying) return;
    setRetrying(true);
    service.signIn({ returnTo: '/' }).catch((error: unknown) => {
      setFailure(authErrorKind(error));
      setRetrying(false);
    });
  }

  if (failure === null) {
    return (
      <AuthScreen title="Entrando">
        <p role="status">Confirmando seu login…</p>
        <div className={styles.bar} aria-hidden="true" />
      </AuthScreen>
    );
  }
  return (
    <AuthScreen title="Não foi possível entrar">
      <Notice tone="negative" message={authMessage(failure)} />
      <div className={styles.actions}>
        <Button variant="primary" onClick={retry} aria-disabled={retrying} aria-busy={retrying}>
          {retrying ? 'Abrindo o login…' : 'Tentar de novo'}
        </Button>
        <Link to="/" className={styles.link}>
          Voltar ao editor
        </Link>
      </div>
    </AuthScreen>
  );
}
