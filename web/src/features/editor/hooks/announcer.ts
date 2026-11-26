import { createStore } from 'zustand/vanilla';

/** Texto da região `aria-live` do editor. `seq` faz a mesma frase ser lida de novo. */
export const announcerStore = createStore<{ message: string; seq: number }>()(() => ({
  message: '',
  seq: 0,
}));

/** Frase fixa do app em pt-BR; nunca o rótulo que o usuário digitou como marcação. */
export function announce(message: string): void {
  announcerStore.setState((s) => ({ message, seq: s.seq + 1 }));
}
