import { stepText } from '../model/history';
import { announce } from './announcer';
import { designStore } from './designStore';

/** Desfaz e avisa em voz alta o que foi desfeito. */
export function undoAndAnnounce(): void {
  const kind = designStore.getState().undo();
  announce(kind ? `Desfeito: ${stepText(kind)}` : 'Nada para desfazer');
}

export function redoAndAnnounce(): void {
  const kind = designStore.getState().redo();
  announce(kind ? `Refeito: ${stepText(kind)}` : 'Nada para refazer');
}
