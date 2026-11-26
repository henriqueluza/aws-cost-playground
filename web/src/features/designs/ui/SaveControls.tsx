import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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

/** Rotas só de leitura: o design fica na store e volta ao editor intacto, então não há o que perder. */
const READ_ONLY_ROUTES: ReadonlySet<string> = new Set(['/comparar']);

/** Pede confirmação ao trocar de rota (ex.: "Meus designs") com alterações não salvas. */
function LeaveGuard({ active }: { active: boolean }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      active &&
      currentLocation.pathname !== nextLocation.pathname &&
      !READ_ONLY_ROUTES.has(nextLocation.pathname),
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
/** `signInAction`: o botão "Entrar" do login (#52); entra no aviso de quem não está autenticado. */
export function SaveControls({ signInAction }: { signInAction?: ReactNode } = {}) {
  const document = useDesignStore((s) => s.document);
  const saved = useSavedDesign((s) => s.saved);
  const saving = useSavedDesign((s) => s.saving);
  const error = useSavedDesign((s) => s.error);
  const save = useSaveDesign();
  const [naming, setNaming] = useState(false);
  const lastName = useRef(DEFAULT_NAME); // o nome do último envio, para "Tentar de novo"

  const status = saveStatus(document, saved, saving);
  const unsaved = hasUnsavedChanges(document, saved);
  const run = (name: string) => {
    lastName.current = name;
    save.mutate({ name, doc: document });
  };
  const retry = () => {
    savedDesignStore.getState().clearError();
    run(lastName.current);
  };

  return (
    <>
      <LeaveGuard active={unsaved} />
      <Link to="/designs" className={styles.link}>
        Meus designs
      </Link>
      {saved !== null && <span className={styles.name}>{saved.name}</span>}
      <StatusPill status={status} />
      <Button
        variant="primary"
        disabled={saving || status === 'saved'}
        onClick={() => (saved === null ? setNaming(true) : run(saved.name))}
      >
        {saving ? 'Salvando…' : 'Salvar'}
      </Button>
      {naming && (
        <NameDialog
          open
          onCancel={() => setNaming(false)}
          onSubmit={(name) => {
            setNaming(false);
            run(name);
          }}
        />
      )}
      <Dialog
        open={error !== null}
        onClose={() => savedDesignStore.getState().clearError()}
        title="Não foi possível salvar"
      >
        {error !== null && <Notice tone="negative" message={designErrorMessage(error)} />}
        <div className={styles.dialogActions}>
          <Button onClick={() => savedDesignStore.getState().clearError()}>Fechar</Button>
          {error === 'unauthenticated' && signInAction}
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
