import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { IconButton } from './Button';
import styles from './Toast.module.css';

/** Quanto o toast fica na tela sem ponteiro em cima nem foco dentro (`ui-ux-pro-max`: 3–5 s). */
export const TOAST_DURATION_MS = 5000;

/** Nome acessível (e tooltip) do botão de fechar. */
export const TOAST_CLOSE_LABEL = 'Fechar mensagem';

export type ToastApi = {
  /** Mostra a frase (texto, nunca HTML). Um toast por vez: substitui o atual e reinicia o tempo. */
  show: (message: string) => void;
};

export type ToastProviderProps = { children: ReactNode };

const ToastContext = createContext<ToastApi | null>(null);

// Lucide x em 16 × 16 (--icon); decorativo, o nome vem do `aria-label` do botão.
const closeIcon = (
  <svg className={styles.closeIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M12 4 4 12M4 4l8 8" />
  </svg>
);

/** `seq` muda a cada `show`: remonta o texto e o leitor de tela reanuncia a mesma frase. */
type Shown = { message: string; seq: number };

/**
 * Renderiza os filhos e, depois deles, a região do toast no canto inferior esquerdo. A região
 * `role="status"` fica sempre montada (vazia quando não há toast) e contém só o texto.
 */
export function ToastProvider({ children }: ToastProviderProps): ReactElement {
  const [shown, setShown] = useState<Shown | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Onde o foco estava antes de entrar no toast; volta para lá ao fechar com o foco dentro.
  const restoreRef = useRef<HTMLElement | null>(null);

  const open = shown !== null;
  const seq = shown?.seq ?? 0;
  const paused = hovered || focusInside;

  const close = useCallback(() => {
    const restore = restoreRef.current;
    // Antes de desmontar o botão: senão o foco cai no `body`.
    if (boxRef.current?.contains(document.activeElement) && restore?.isConnected) restore.focus();
    restoreRef.current = null;
    setShown(null);
    // Com `pointer-events: none` ao fechar, o `pointerleave` pode não chegar.
    setHovered(false);
    setFocusInside(false);
  }, []);

  const show = useCallback((message: string) => {
    setShown((current) => ({ message, seq: (current?.seq ?? 0) + 1 }));
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  // WCAG 2.2.1: o tempo para com o ponteiro em cima ou o foco dentro e recomeça inteiro depois.
  useEffect(() => {
    if (!open || paused) return;
    const timer = setTimeout(close, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [open, seq, paused, close]);

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    const from = event.relatedTarget;
    if (from instanceof Node && event.currentTarget.contains(from)) return;
    restoreRef.current = from instanceof HTMLElement ? from : null;
    setFocusInside(true);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const to = event.relatedTarget;
    if (to instanceof Node && event.currentTarget.contains(to)) return;
    setFocusInside(false);
  }

  // O Esc só chega aqui com o foco dentro da caixa.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') close();
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        ref={boxRef}
        className={styles.toast}
        data-open={open ? '' : undefined}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <div role="status" className={styles.message}>
          {shown ? <span key={shown.seq}>{shown.message}</span> : null}
        </div>
        {open ? (
          <IconButton aria-label={TOAST_CLOSE_LABEL} onClick={close}>
            {closeIcon}
          </IconButton>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

/** O `show` do `ToastProvider` mais próximo. Fora dele, lança erro. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast precisa estar dentro de um ToastProvider.');
  return api;
}
