import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Button, Notice } from '../../../shared/ui';
import type { AuthErrorKind } from '../model/authError';
import { authErrorKind, authMessage } from '../model/authMessages';
import { AuthScreen } from './AuthScreen';
import styles from './AuthScreen.module.css';
import { useAuth } from './AuthProvider';

/**
 * Rota que exige conta. Sem sessão, leva ao login guardando o destino (o `safeReturnTo` do
 * serviço o confere); com sessão, mostra a página. O pedido sai uma vez só, mesmo no StrictMode.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { service, snapshot } = useAuth();
  const { pathname, search } = useLocation();
  const asked = useRef(false);
  const [failure, setFailure] = useState<AuthErrorKind | null>(null);
  const anonymous = snapshot.status === 'anonymous';

  function signIn() {
    setFailure(null);
    service.signIn({ returnTo: `${pathname}${search}` }).catch((error: unknown) => {
      setFailure(authErrorKind(error));
    });
  }

  useEffect(() => {
    if (!anonymous) asked.current = false; // a próxima queda pede o login de novo
    if (!anonymous || asked.current) return;
    asked.current = true;
    signIn();
    // O pedido depende só de a sessão estar ausente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anonymous]);

  if (!anonymous) return children;
  return (
    <AuthScreen title="Entre para continuar">
      {failure === null ? (
        <>
          <p role="status">Levando você ao login…</p>
          <div className={styles.bar} aria-hidden="true" />
        </>
      ) : (
        <>
          <Notice tone="negative" message={authMessage(failure)} />
          <div className={styles.actions}>
            <Button variant="primary" onClick={signIn}>
              Entrar
            </Button>
            <Link to="/" className={styles.link}>
              Voltar ao editor
            </Link>
          </div>
        </>
      )}
    </AuthScreen>
  );
}
