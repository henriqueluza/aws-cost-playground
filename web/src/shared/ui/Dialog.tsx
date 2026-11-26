import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Dialog.module.css';

export type DialogProps = {
  /** Aberto ou fechado. Quem controla é a feature; fechado, nada é renderizado. */
  open: boolean;
  /** Pedido de fechar (Esc). A feature decide e muda `open`. */
  onClose: () => void;
  /** Título (h2) e nome acessível do diálogo. Texto da interface, nunca HTML. */
  title: string;
  /** Conteúdo e ações. Ao abrir, o foco vai para o primeiro controle (sem `autoFocus` nos
   *  filhos); por isso "Cancelar" vem antes do primário. Deve ter ao menos um controle que feche. */
  children: ReactNode;
};

type Focusable = HTMLElement | SVGElement;

// Tabuláveis por seletor, sem medir layout (o jsdom não tem layout).
const TABBABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable]';

function tabbables(root: HTMLElement): Focusable[] {
  return Array.from(root.querySelectorAll<Focusable>(TABBABLE)).filter(
    (el) => !el.matches(':disabled') && el.tabIndex >= 0 && el.closest('[hidden]') === null,
  );
}

/** Para onde o Tab vai nas bordas; `null` deixa o navegador mover (radio, ordem nativa). */
function wrapTarget(dialog: HTMLElement, backwards: boolean): Focusable | null {
  const items = tabbables(dialog);
  const [first, last] = [items[0], items.at(-1)];
  if (first === undefined || last === undefined) return dialog;
  const active = document.activeElement;
  if (backwards) return active === first || active === dialog ? last : null;
  return active === last ? first : null;
}

/** Diálogo modal: prende o foco, fecha com Esc e devolve o foco a quem o abriu. */
export function Dialog({ open, ...surface }: DialogProps): ReactElement | null {
  return open ? <DialogSurface {...surface} /> : null;
}

function DialogSurface({ onClose, title, children }: Omit<DialogProps, 'open'>): ReactElement {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // No render: o `autoFocus` de um filho roda antes de qualquer effect desta superfície.
  const [trigger] = useState<Focusable | null>(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement || active instanceof SVGElement ? active : null;
  });

  // Só ao montar e desmontar (o `onClose` fica fora): foco inicial, guarda e retorno do foco.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusFirst = () => (tabbables(dialog)[0] ?? dialog).focus();
    focusFirst(); // ignora o `autoFocus` dos filhos: dev e StrictMode se comportam igual
    // Adiada: se a feature levou o foco para fora ao fechar, o diálogo já saiu do DOM e o foco
    // fica onde ela pôs. Um diálogo por vez: duas guardas disputariam o foco em loop.
    const guard = () =>
      setTimeout(() => {
        if (dialog.isConnected && !dialog.contains(document.activeElement)) focusFirst();
      });
    document.addEventListener('focusin', guard);
    // Antes de o React tirar o portal do DOM. Não rouba o foco que a feature moveu.
    return () => {
      document.removeEventListener('focusin', guard);
      const active = document.activeElement;
      const ownsFocus = active === null || active === document.body || dialog.contains(active);
      if (ownsFocus && trigger?.isConnected) trigger.focus();
    };
  }, [trigger]);

  // Controle focado removido ou desabilitado: o foco cai no `body`. A tecla não passa à página.
  useEffect(() => {
    const fromBody = (event: globalThis.KeyboardEvent) => {
      if (event.target !== document.body) return;
      event.stopPropagation();
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', fromBody, true);
    return () => window.removeEventListener('keydown', fromBody, true);
  }, [onClose]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Sempre: o nativo chegaria ao `document`, onde o React Flow apaga o bloco no Backspace.
    event.stopPropagation();
    const dialog = dialogRef.current;
    if (dialog === null || event.defaultPrevented) return; // um filho já tratou a tecla
    if (event.key === 'Tab') {
      const target = wrapTarget(dialog, event.shiftKey);
      if (target === null) return;
      event.preventDefault();
      target.focus();
    } else if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      onClose(); // o Esc que encerra a composição do IME não fecha
    }
  }

  return createPortal(
    <div
      className={styles.scrim}
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => event.target === event.currentTarget && event.preventDefault()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.dialog}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
