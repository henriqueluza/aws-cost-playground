import { useEffect } from 'react';
import { redoAndAnnounce, undoAndAnnounce } from './historyCommands';

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Campo de texto, seleção ou área editável: ali o desfazer nativo é quem vale. */
const inField = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(EDITABLE) !== null;

const dialogOpen = (): boolean =>
  document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

/** `undo`, `redo` ou `null` para o gesto de teclado; `null` não consome a tecla. */
export function historyShortcut(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (e.altKey || e.defaultPrevented) return null;
  const key = e.key.toLowerCase();
  if (key === 'z' && (e.ctrlKey || e.metaKey)) return e.shiftKey ? 'redo' : 'undo';
  // Ctrl+Y refaz no Windows e no Linux; no Mac o Ctrl+Y é do campo de texto.
  if (key === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey) return 'redo';
  return null;
}

/** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z e Ctrl+Y no editor, fora de campo e de diálogo. */
export function useHistoryShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = historyShortcut(e);
      if (action === null || inField(e.target) || dialogOpen()) return;
      e.preventDefault();
      if (action === 'undo') undoAndAnnounce();
      else redoAndAnnounce();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
