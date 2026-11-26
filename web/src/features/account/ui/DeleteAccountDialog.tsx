import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiErrorKind } from '../../../shared/lib/api';
import { Button, Dialog, Notice, TextField } from '../../../shared/ui';
import {
  CONFIRM_WORD,
  confirmationMatches,
  deleteErrorMessage,
  isRetryable,
} from '../model/accountMessages';
import styles from './AccountPage.module.css';

export type DeleteAccountDialogProps = {
  open: boolean;
  pending: boolean;
  /** Código do último erro de exclusão, ou `null`. */
  failure: ApiErrorKind | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** Leva ao login quando a sessão expirou (`unauthenticated`). */
  onSignIn: () => void;
};

/** Pede a palavra de confirmação e só então libera a exclusão. O campo nasce vazio a cada abertura. */
export function DeleteAccountDialog(props: DeleteAccountDialogProps) {
  const { open, onCancel } = props;
  return (
    <Dialog
      open={open}
      onClose={() => !props.pending && onCancel()}
      title="Excluir a conta para sempre?"
    >
      <DeleteForm {...props} />
    </Dialog>
  );
}

function DeleteForm({ pending, failure, onCancel, onConfirm, onSignIn }: DeleteAccountDialogProps) {
  const [typed, setTyped] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const ready = confirmationMatches(typed);
  const expired = failure === 'unauthenticated';

  // O botão desabilitado em "excluindo" perde o foco; ao falhar, ele volta para onde a ação está.
  useEffect(() => {
    if (failure !== null) confirmRef.current?.focus();
  }, [failure]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready && !pending) onConfirm();
  }

  return (
    <form onSubmit={submit} className={styles.dialogForm} noValidate>
      <p className={styles.text}>Isto apaga, de forma definitiva:</p>
      <ul className={styles.list}>
        <li>todos os designs salvos na sua conta;</li>
        <li>o contador das suas estimativas;</li>
        <li>a sua conta de login.</li>
      </ul>
      <p className={styles.text}>
        <strong>Não há volta:</strong> não conseguimos recuperar nada depois. Você será desconectado
        e voltará ao editor, sem conta.
      </p>
      <TextField
        label={`Digite ${CONFIRM_WORD} para confirmar`}
        density="form"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={pending}
      />
      {failure !== null && <Notice tone="negative" message={deleteErrorMessage(failure)} />}
      {pending && (
        <p role="status" className={styles.text}>
          Excluindo a conta…
        </p>
      )}
      <div className={styles.dialogActions}>
        <Button onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        {expired ? (
          <Button variant="primary" onClick={onSignIn}>
            Entrar
          </Button>
        ) : (
          <Button ref={confirmRef} variant="destructive" type="submit" disabled={!ready || pending}>
            {failure !== null && isRetryable(failure) ? 'Tentar de novo' : 'Excluir conta'}
          </Button>
        )}
      </div>
    </form>
  );
}
