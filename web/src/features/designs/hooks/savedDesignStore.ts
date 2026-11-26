import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { ApiErrorKind } from '../../../shared/lib/api';
import type { SavedDesign } from '../model/saveState';

export type SavedDesignState = {
  saved: SavedDesign | null;
  saving: boolean;
  error: ApiErrorKind | null;
  /** Reserva o salvamento: `false` se já há um em andamento (evita salvamento duplo). */
  begin(): boolean;
  finish(saved: SavedDesign): void;
  fail(kind: ApiErrorKind): void;
  setSaved(saved: SavedDesign | null): void;
  clearError(): void;
};

export const createSavedDesignStore = () =>
  createStore<SavedDesignState>()((set, get) => ({
    saved: null,
    saving: false,
    error: null,
    begin: () => {
      if (get().saving) return false;
      set({ saving: true, error: null });
      return true;
    },
    finish: (saved) => set({ saved, saving: false, error: null }),
    fail: (error) => set({ saving: false, error }),
    setSaved: (saved) => set({ saved }),
    clearError: () => set({ error: null }),
  }));

/** O design salvo atual: um só por aba, como a store do editor. */
export const savedDesignStore = createSavedDesignStore();

export function useSavedDesign<T>(selector: (state: SavedDesignState) => T): T {
  return useStore(savedDesignStore, selector);
}
