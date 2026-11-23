import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

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

/**
 * Renderiza os filhos e, depois deles, a região do toast no canto inferior esquerdo. A região
 * `role="status"` fica sempre montada (vazia quando não há toast) e contém só o texto.
 */
export function ToastProvider({ children }: ToastProviderProps): ReactElement {
  // Contrato (#146): a implementação vem no pacote A.
  return <ToastContext.Provider value={null}>{children}</ToastContext.Provider>;
}

/** O `show` do `ToastProvider` mais próximo. Fora dele, lança erro. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast precisa estar dentro de um ToastProvider.');
  return api;
}
