import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { ApiErrorKind } from '../../../shared/lib/api';
import type { SavedDesign } from '../model/saveState';

export type SavedDesignState = {
  saved: SavedDesign | null;
  saving: boolean;
  /** Sobe quando o vínculo muda por fora de um salvamento: o resultado de um envio antigo é ignorado. */
  epoch: number;
  error: ApiErrorKind | null;
  /** Reserva o salvamento: `false` se já há um em andamento (evita salvamento duplo). */
  begin(): boolean;
  /** Grava o resultado do envio; `false` se o vínculo mudou no meio (o resultado é descartado). */
  finish(saved: SavedDesign, epoch: number): boolean;
  /** Solta o vínculo com o design salvo (o documento deixou de ser o dele); o próximo salvar cria outro. */
  unlink(): void;
  fail(kind: ApiErrorKind): void;
  setSaved(saved: SavedDesign | null): void;
  clearError(): void;
};

export const createSavedDesignStore = () =>
  createStore<SavedDesignState>()((set, get) => ({
    saved: null,
    saving: false,
    epoch: 0,
    error: null,
    begin: () => {
      if (get().saving) return false;
      set({ saving: true, error: null });
      return true;
    },
    finish: (saved, epoch) => {
      if (get().epoch !== epoch) {
        set({ saving: false });
        return false;
      }
      set({ saved, saving: false, error: null });
      return true;
    },
    unlink: () => set((s) => ({ saved: null, epoch: s.epoch + 1, error: null })),
    fail: (error) => set({ saving: false, error }),
    setSaved: (saved) => set((s) => ({ saved, epoch: s.epoch + 1 })),
    clearError: () => set({ error: null }),
  }));

/** O design salvo atual: um só por aba, como a store do editor. */
export const savedDesignStore = createSavedDesignStore();

export function useSavedDesign<T>(selector: (state: SavedDesignState) => T): T {
  return useStore(savedDesignStore, selector);
}

/** Esquece o design salvo associado (a conta saiu ou foi excluída): o próximo salvar cria um novo. */
export function forgetSavedDesign(): void {
  savedDesignStore.setState((s) => ({
    saved: null,
    saving: false,
    error: null,
    epoch: s.epoch + 1,
  }));
}
