import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { isApiError, type DesignSummary } from '../../../shared/lib/api';
import { useDesignStore } from '../../editor';
import { Button, Dialog, EmptyState, Notice } from '../../../shared/ui';
import { useSavedDesign } from '../hooks/savedDesignStore';
import { useDesignsList, useOpenDesign } from '../hooks/useDesigns';
import { DESIGN_LIMIT, designErrorMessage, isRetryable } from '../model/designMessages';
import { blockCountLabel, formatUpdatedAt } from '../model/format';
import { hasUnsavedChanges } from '../model/saveState';
import styles from './DesignsPage.module.css';

const SKELETON_ROWS = 4;

function LoadingRows() {
  return (
    <div aria-busy="true" role="status" className={styles.loading}>
      <span className={styles.srOnly}>Carregando seus designs…</span>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className={styles.skeletonRow} aria-hidden="true">
          <span className={styles.bar} />
          <span className={styles.bar} />
          <span className={styles.bar} />
        </div>
      ))}
    </div>
  );
}

function DesignsTable(props: { designs: DesignSummary[]; onOpen: (d: DesignSummary) => void }) {
  return (
    <table className={styles.table}>
      <caption className={styles.srOnly}>
        Seus designs salvos, do mais recente ao mais antigo
      </caption>
      <thead>
        <tr>
          <th scope="col">Nome</th>
          <th scope="col">Região</th>
          <th scope="col" className={styles.num}>
            Blocos
          </th>
          <th scope="col">Atualizado em</th>
          <th scope="col">
            <span className={styles.srOnly}>Ações</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {props.designs.map((d) => (
          <tr key={d.id}>
            <th scope="row" className={styles.name} title={d.name}>
              {d.name}
            </th>
            <td className={styles.mono}>{d.region}</td>
            <td className={styles.num}>{blockCountLabel(d.blockCount)}</td>
            <td className={styles.mono}>
              <time dateTime={d.updatedAt}>{formatUpdatedAt(d.updatedAt)}</time>
            </td>
            <td className={styles.open}>
              <Button onClick={() => props.onOpen(d)} aria-label={`Abrir ${d.name}`}>
                Abrir
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Convite para entrar. O botão "Entrar" é do login (#52): entra por `signInAction`. */
function SignInInvite({ action }: { action?: ReactNode }) {
  return (
    <EmptyState
      headingLevel={2}
      title="Entre para ver seus designs"
      description="Os designs salvos ficam na sua conta. Entre para salvá-los, listá-los e abri-los em qualquer lugar."
      action={action ?? <Link to="/">Continuar no editor, sem conta</Link>}
    />
  );
}

/** "Meus designs" (F23): lista os designs da conta e abre um no editor. */
export function DesignsPage({ signInAction }: { signInAction?: ReactNode }) {
  const navigate = useNavigate();
  const list = useDesignsList();
  const open = useOpenDesign();
  const current = useDesignStore((s) => s.document);
  const saved = useSavedDesign((s) => s.saved);
  const [pending, setPending] = useState<DesignSummary | null>(null);

  const run = (id: string) => {
    setPending(null);
    open.mutate(id, { onSuccess: () => void navigate('/') });
  };
  const request = (d: DesignSummary) =>
    hasUnsavedChanges(current, saved) ? setPending(d) : run(d.id);

  const failure = list.error ?? null;
  const anonymous = isApiError(failure, 'unauthenticated');
  const openError = open.error;

  let body: ReactNode;
  if (anonymous) body = <SignInInvite action={signInAction} />;
  else if (list.isPending) body = <LoadingRows />;
  else if (list.isError) {
    const kind = isApiError(failure) ? failure.kind : 'unavailable';
    body = (
      <div className={styles.block}>
        <Notice tone="negative" message={designErrorMessage(kind)} />
        <Button onClick={() => void list.refetch()}>Tentar de novo</Button>
      </div>
    );
  } else if (list.data.length === 0) {
    body = (
      <EmptyState
        headingLevel={2}
        title="Nenhum design salvo"
        description="Monte um diagrama no editor e use Salvar para vê-lo aqui."
        action={<Link to="/">Ir para o editor</Link>}
      />
    );
  } else body = <DesignsTable designs={list.data} onOpen={request} />;

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <header className={styles.header}>
          <h1 className={styles.title}>Meus designs</h1>
          {list.data !== undefined && list.data.length > 0 && (
            <span className={styles.count}>
              {list.data.length} de {DESIGN_LIMIT}
            </span>
          )}
          <Link to="/" className={styles.back}>
            Voltar ao editor
          </Link>
        </header>
        {openError !== null && (
          <div className={styles.block}>
            <Notice
              tone="negative"
              message={designErrorMessage(isApiError(openError) ? openError.kind : 'unavailable')}
            />
            {isApiError(openError) &&
              isRetryable(openError.kind) &&
              open.variables !== undefined && (
                <Button onClick={() => run(open.variables)}>Tentar de novo</Button>
              )}
          </div>
        )}
        {body}
      </div>
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Abrir e descartar alterações?"
      >
        <p className={styles.text}>
          O design atual tem alterações não salvas. Abrir {pending?.name ?? 'o design'} as descarta.
        </p>
        <div className={styles.dialogActions}>
          <Button onClick={() => setPending(null)}>Cancelar</Button>
          <Button variant="destructive" onClick={() => pending && run(pending.id)}>
            Abrir sem salvar
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
