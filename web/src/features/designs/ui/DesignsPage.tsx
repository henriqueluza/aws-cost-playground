import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { designNameSchema, isApiError, type DesignSummary } from '../../../shared/lib/api';
import { hasUnsavedChanges, useDesignStore } from '../../editor';
import { Button, Dialog, EmptyState, Notice, TextField } from '../../../shared/ui';
import {
  useDeleteDesign,
  useDesignsList,
  useDuplicateDesign,
  useOpenDesign,
  useRenameDesign,
} from '../hooks/useDesigns';
import { DESIGN_LIMIT, copyName, designErrorMessage, isRetryable } from '../model/designMessages';
import { blockCountLabel, formatUpdatedAt } from '../model/format';
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
          <span className={styles.bar} />
        </div>
      ))}
    </div>
  );
}

type RowAction = 'rename' | 'duplicate' | 'delete';

function DesignsTable(props: {
  designs: DesignSummary[];
  onOpen: (d: DesignSummary) => void;
  onAction: (action: RowAction, d: DesignSummary) => void;
}) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className={styles.srOnly}>Seus designs salvos</caption>
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
                <Button
                  onClick={() => props.onAction('rename', d)}
                  aria-label={`Renomear ${d.name}`}
                >
                  Renomear
                </Button>
                <Button
                  onClick={() => props.onAction('duplicate', d)}
                  aria-label={`Duplicar ${d.name}`}
                >
                  Duplicar
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => props.onAction('delete', d)}
                  aria-label={`Apagar ${d.name}`}
                >
                  Apagar
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

/** Pede um nome (renomear ou duplicar); o nome passa pelo mesmo schema do salvar. */
function NameForm(props: {
  title: string;
  initial: string;
  submitLabel: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(props.initial);
  const [error, setError] = useState<string | undefined>();
  return (
    <Dialog open onClose={props.onCancel} title={props.title}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = designNameSchema.safeParse(name);
          if (!parsed.success) return setError('Use um nome de 1 a 80 caracteres.');
          props.onSubmit(parsed.data);
        }}
      >
        <TextField
          label="Nome do design"
          density="form"
          value={name}
          error={error}
          maxLength={80}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <div className={styles.dialogActions}>
          <Button onClick={props.onCancel}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={props.busy}>
            {props.submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** "Meus designs" (F23): lista os designs da conta e abre um no editor. */
export function DesignsPage({ signInAction }: { signInAction?: ReactNode }) {
  const navigate = useNavigate();
  const list = useDesignsList();
  const open = useOpenDesign();
  const unsaved = useDesignStore((s) => hasUnsavedChanges(s.document, s.baseline));
  const [pending, setPending] = useState<DesignSummary | null>(null);
  const [action, setAction] = useState<{ kind: RowAction; design: DesignSummary } | null>(null);
  const rename = useRenameDesign();
  const duplicate = useDuplicateDesign();
  const remove = useDeleteDesign();
  const [actionError, setActionError] = useState<string | null>(null);

  const close = () => setAction(null);
  const fail = (error: unknown) => {
    close();
    setActionError(designErrorMessage(isApiError(error) ? error.kind : 'unavailable'));
  };
  const request_ = (kind: RowAction, design: DesignSummary) => {
    setActionError(null);
    // No limite, duplicar não pode funcionar: avisa já, sem pedir nome.
    if (kind === 'duplicate' && (list.data?.length ?? 0) >= DESIGN_LIMIT) {
      return setActionError(designErrorMessage('design-limit'));
    }
    setAction({ kind, design });
  };

  const run = (id: string) => {
    setPending(null);
    open.mutate(id, { onSuccess: () => void navigate('/') });
  };
  const request = (d: DesignSummary) => (unsaved ? setPending(d) : run(d.id));

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
  } else body = <DesignsTable designs={list.data} onOpen={request} onAction={request_} />;

  return (
    <main className={styles.page}>
      <div className={styles.sheet}>
        <header className={styles.header}>
          <h1 className={styles.title}>Meus designs</h1>
          {list.data !== undefined && list.data.length > 0 && (
            <span className={styles.count}>
              {list.data.length} de {DESIGN_LIMIT} designs
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
        {actionError !== null && (
          <div className={styles.block}>
            <Notice tone="negative" message={actionError} />
          </div>
        )}
        {body}
      </div>
      {action?.kind === 'rename' && (
        <NameForm
          title="Renomear design"
          initial={action.design.name}
          submitLabel="Renomear"
          busy={rename.isPending}
          onCancel={close}
          onSubmit={(name) =>
            rename.mutate(
              { id: action.design.id, version: action.design.version, name },
              { onSuccess: close, onError: fail },
            )
          }
        />
      )}
      {action?.kind === 'duplicate' && (
        <NameForm
          title="Duplicar design"
          initial={copyName(action.design.name)}
          submitLabel="Duplicar"
          busy={duplicate.isPending}
          onCancel={close}
          onSubmit={(name) =>
            duplicate.mutate({ id: action.design.id, name }, { onSuccess: close, onError: fail })
          }
        />
      )}
      <Dialog open={action?.kind === 'delete'} onClose={close} title="Apagar design?">
        <p className={styles.text}>
          {action?.design.name ?? 'O design'} será apagado da sua conta. Isso não pode ser desfeito.
        </p>
        <div className={styles.dialogActions}>
          <Button onClick={close}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              action && remove.mutate(action.design.id, { onSuccess: close, onError: fail })
            }
          >
            Apagar
          </Button>
        </div>
      </Dialog>
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
