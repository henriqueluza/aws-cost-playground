import { useEffect, useId, useState, type ReactElement } from 'react';
import { Button, Notice, TextAreaField } from '../../../shared/ui';
import { useAuth } from '../../auth';
import { useDesignStore } from '../../editor';
import { useWorkloadEstimate } from '../hooks/useWorkloadEstimate';
import { DESCRIPTION_LIMIT, freshness } from '../model/estimateModel';
import {
  SIGN_IN_ERROR,
  appliedMessage,
  blockedReason,
  counterAnnouncement,
  failureMessage,
  lockOf,
  quotaLine,
  quotaRatio,
} from '../model/messages';
import styles from './WorkloadPanel.module.css';

const COUNT = new Intl.NumberFormat('pt-BR');

/** Relógio de meio minuto: a trava de quota solta sozinha quando a hora de voltar passa. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Aba "Carga": a descrição da carga (parte do design) e a re-estimativa do uso por blocos e arestas. */
export function WorkloadPanel(): ReactElement {
  const { service, snapshot } = useAuth();
  const signedIn = snapshot.status === 'authenticated';
  const document = useDesignStore((s) => s.document);
  const setDescription = useDesignStore((s) => s.setDescription);
  const { run, estimate } = useWorkloadEstimate(signedIn);
  const [signInFailed, setSignInFailed] = useState(false);
  const now = useNow();
  const hintId = useId();
  const countId = useId();

  const description = document.workload.description;
  const loading = run.phase === 'loading';
  const state = freshness(run.fingerprint, document);
  const lock = lockOf(run.failure, run.quota, now);
  const reason = blockedReason({ blocks: document.blocks.length, description, locked: lock });
  const disabled = loading || reason !== null;
  const showFailure = run.failure !== null && run.failure.kind !== 'sign-in';
  // A frase da trava (429) já está no aviso; repetir abaixo do botão seria ruído.
  const hint = showFailure && lock === run.failure ? null : reason;
  const mustSignIn = !signedIn || run.failure?.kind === 'sign-in';

  const signIn = () => {
    setSignInFailed(false);
    service.signIn({ returnTo: window.location.pathname }).catch(() => setSignInFailed(true));
  };

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>Carga</h2>
      <div className={styles.group}>
        <TextAreaField
          label="Descrição da carga"
          rows={7}
          maxLength={DESCRIPTION_LIMIT}
          value={description}
          describedBy={[hintId, countId]}
          onChange={(e) => void setDescription(e.target.value)}
        />
        <div className={styles.counter}>
          <p id={hintId} className={styles.hint}>
            Quantos usuários, requisições e dados por mês. Vale para o diagrama todo.
          </p>
          <p
            id={countId}
            className={styles.count}
            data-full={description.length >= DESCRIPTION_LIMIT}
          >
            <span aria-hidden="true">
              {COUNT.format(description.length)} / {COUNT.format(DESCRIPTION_LIMIT)}
            </span>
            <span className={styles.srOnly}>
              {COUNT.format(description.length)} de {COUNT.format(DESCRIPTION_LIMIT)} caracteres
            </span>
          </p>
          <span className={styles.srOnly} role="status">
            {counterAnnouncement(description.length)}
          </span>
        </div>
      </div>

      {mustSignIn ? (
        <div className={styles.group}>
          <Notice
            tone="neutral"
            message="Entre na sua conta para estimar a carga com a LLM. Sem entrar, o editor continua calculando com os valores que você definir."
          />
          <div>
            <Button onClick={signIn}>Entrar</Button>
          </div>
          {signInFailed ? <Notice tone="negative" message={SIGN_IN_ERROR} /> : null}
        </div>
      ) : (
        <div className={styles.group}>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              aria-disabled={disabled}
              aria-describedby={hint ? `${hintId}-why` : undefined}
              onClick={() => {
                if (!disabled) void estimate();
              }}
            >
              {loading ? 'Estimando…' : 'Re-estimar carga'}
            </Button>
            {state === 'stale' ? (
              <span className={styles.pill}>Estimativa desatualizada</span>
            ) : null}
          </div>
          {hint ? (
            <p id={`${hintId}-why`} className={styles.hint}>
              {hint}
            </p>
          ) : null}
          {run.quota ? (
            <div className={styles.quota}>
              <p className={styles.quotaText}>{quotaLine(run.quota)}</p>
              <div className={styles.track} aria-hidden="true">
                <div className={styles.fill} style={{ width: `${quotaRatio(run.quota) * 100}%` }} />
              </div>
            </div>
          ) : null}
          <p role="status" className={styles.status}>
            {run.applied ? appliedMessage(run.applied.blocks, run.applied.edges) : ''}
          </p>
          {showFailure && run.failure ? (
            <Notice
              tone={run.failure.kind.startsWith('quota') ? 'warning' : 'negative'}
              message={failureMessage(run.failure)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
