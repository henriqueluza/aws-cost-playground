import { useEffect, useState, type FormEvent } from 'react';
import { Link, useBlocker } from 'react-router';
import { useDesignStore } from '../../editor';
import { designNameSchema } from '../../../shared/lib/api';
import { Button, Dialog, Notice, TextField } from '../../../shared/ui';
import { savedDesignStore, useSavedDesign } from '../hooks/savedDesignStore';
import { useSaveDesign } from '../hooks/useDesigns';
import { designErrorMessage, isRetryable } from '../model/designMessages';
import {
  hasUnsavedChanges,
  SAVE_STATUS_LABEL,
  saveStatus,
  type SaveStatus,
} from '../model/saveState';
import styles from './SaveControls.module.css';

const DEFAULT_NAME = 'Meu design';

/** Avisa antes de sair da página (fechar a aba, recarregar) com alterações não salvas. */
function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

/** Pede confirmação ao trocar de rota (ex.: "Meus designs") com alterações não salvas. */
function LeaveGuard({ active }: { active: boolean }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      active && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnload(active);
  return (
    <Dialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.state === 'blocked' && blocker.reset()}
      title="Sair sem salvar?"
    >
      <p className={styles.text}>As alterações deste design ainda não foram salvas.</p>
      <div className={styles.dialogActions}>
        <Button onClick={() => blocker.state === 'blocked' && blocker.reset()}>
          Continuar editando
        </Button>
        <Button
          variant="destructive"
          onClick={() => blocker.state === 'blocked' && blocker.proceed()}
        >
          Sair sem salvar
        </Button>
      </div>
    </Dialog>
  );
}

/** Estado do salvamento; `role="status"` (aria-live educado) anuncia cada mudança. */
function StatusPill({ status }: { status: SaveStatus }) {
  return (
    <span role="status" className={`${styles.pill} ${status === 'dirty' ? styles.warn : ''}`}>
      {SAVE_STATUS_LABEL[status]}
    </span>
  );
}

function NameDialog(props: { open: boolean; onCancel: () => void; onSubmit: (n: string) => void }) {
  const [name, setName] = useState(DEFAULT_NAME);
  const [error, setError] = useState<string | undefined>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = designNameSchema.safeParse(name);
    if (!parsed.success) return setError('Use um nome de 1 a 80 caracteres.');
    setError(undefined);
    props.onSubmit(parsed.data);
  };
  return (
    <Dialog open={props.open} onClose={props.onCancel} title="Salvar design">
      <form onSubmit={submit} noValidate>
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
          <Button type="submit" variant="primary">
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Salvar, estado do salvamento e atalho para "Meus designs", na barra de ações do editor. */
export function SaveControls() {
  const document = useDesignStore((s) => s.document);
  const saved = useSavedDesign((s) => s.saved);
  const saving = useSavedDesign((s) => s.saving);
  const error = useSavedDesign((s) => s.error);
  const save = useSaveDesign();
  const [naming, setNaming] = useState(false);

  const status = saveStatus(document, saved, saving);
  const unsaved = hasUnsavedChanges(document, saved);
  const run = (name: string) => save.mutate({ name, doc: document });
  const retry = () => {
    savedDesignStore.getState().clearError();
    run(saved?.name ?? DEFAULT_NAME);
  };

  return (
    <>
      <LeaveGuard active={unsaved} />
      {saved !== null && <span className={styles.name}>{saved.name}</span>}
      <StatusPill status={status} />
      <Link to="/designs" className={styles.link}>
        Meus designs
      </Link>
      <Button
        variant="primary"
        disabled={saving || status === 'saved'}
        title={status === 'saved' ? 'Sem alterações para salvar' : undefined}
        onClick={() => (saved === null ? setNaming(true) : run(saved.name))}
      >
        {saving ? 'Salvando…' : 'Salvar'}
      </Button>
      <NameDialog
        open={naming}
        onCancel={() => setNaming(false)}
        onSubmit={(name) => {
          setNaming(false);
          run(name);
        }}
      />
      <Dialog
        open={error !== null}
        onClose={() => savedDesignStore.getState().clearError()}
        title="Não foi possível salvar"
      >
        {error !== null && <Notice tone="negative" message={designErrorMessage(error)} />}
        <div className={styles.dialogActions}>
          <Button onClick={() => savedDesignStore.getState().clearError()}>Fechar</Button>
          {error !== null && isRetryable(error) && (
            <Button variant="primary" onClick={retry}>
              Tentar de novo
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
