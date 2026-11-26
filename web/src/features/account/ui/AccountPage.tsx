import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { isApiError, type ApiErrorKind } from '../../../shared/lib/api';
import { Button, Notice } from '../../../shared/ui';
import { useAuth } from '../../auth';
import { useDeleteAccount, useQuota } from '../hooks/useAccount';
import { formatResetsAt, quotaSummary } from '../model/format';
import { isRetryable, quotaErrorMessage } from '../model/accountMessages';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import styles from './AccountPage.module.css';

const kindOf = (error: unknown): ApiErrorKind => (isApiError(error) ? error.kind : 'unavailable');

/** Conta (F25): quem está logado, quanto resta da quota de estimativas e a exclusão da conta. */
export function AccountPage() {
  const { service, snapshot } = useAuth();
  const quota = useQuota();
  const remove = useDeleteAccount();
  const [confirming, setConfirming] = useState(false);

  const email = snapshot.status === 'authenticated' ? snapshot.user.email : null;
  const signIn = () => void service.signIn({ returnTo: '/conta' }).catch(() => undefined);

  function close() {
    setConfirming(false);
    remove.reset();
  }

  let quotaBody: ReactNode;
  if (quota.isPending) {
    quotaBody = (
      <div role="status" aria-busy="true">
        <span className={styles.srOnly}>Carregando suas estimativas…</span>
        <div className={styles.bar} aria-hidden="true" />
      </div>
    );
  } else if (quota.isError) {
    const kind = kindOf(quota.error);
    quotaBody = (
      <div className={styles.block}>
        <Notice tone="negative" message={quotaErrorMessage(kind)} />
        {kind === 'unauthenticated' ? (
          <Button variant="primary" onClick={signIn}>
            Entrar
          </Button>
        ) : (
          isRetryable(kind) && <Button onClick={() => void quota.refetch()}>Tentar de novo</Button>
        )}
      </div>
    );
  } else {
    quotaBody = (
      <>
        <p className={styles.figure}>
          <b>{quota.data.remaining}</b> de {quota.data.limit}
        </p>
        <p className={styles.text}>{quotaSummary(quota.data.remaining, quota.data.limit)}.</p>
        <p className={styles.muted}>
          Renova em{' '}
          <time dateTime={quota.data.resetsAt}>{formatResetsAt(quota.data.resetsAt)}</time>
        </p>
      </>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <header className={styles.header}>
          <h1 className={styles.title}>Conta</h1>
          <Link to="/" className={styles.back}>
            Voltar ao editor
          </Link>
        </header>

        <section className={styles.section} aria-labelledby="conta-sessao">
          <h2 id="conta-sessao" className={styles.heading}>
            Sessão
          </h2>
          <dl className={styles.facts}>
            <dt>E-mail</dt>
            <dd>{email ?? 'Não informado pelo provedor de login'}</dd>
          </dl>
        </section>

        <section className={styles.section} aria-labelledby="conta-quota">
          <h2 id="conta-quota" className={styles.heading}>
            Estimativas de uso por IA
          </h2>
          {quotaBody}
        </section>

        <section className={styles.section} aria-labelledby="conta-excluir">
          <h2 id="conta-excluir" className={styles.heading}>
            Excluir conta
          </h2>
          <p className={styles.text}>
            Apaga seus designs salvos, o contador de estimativas e a conta de login. Não há como
            desfazer.
          </p>
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            Excluir minha conta…
          </Button>
        </section>
      </div>
      <DeleteAccountDialog
        open={confirming}
        pending={remove.isPending}
        failure={remove.isError ? kindOf(remove.error) : null}
        onCancel={close}
        onConfirm={() => !remove.isPending && remove.mutate()}
        onSignIn={signIn}
      />
    </main>
  );
}
