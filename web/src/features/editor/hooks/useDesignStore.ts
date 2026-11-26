import { useStore } from 'zustand';
import { designStore, type DesignStoreState } from '../application/designStore';

export function useDesignStore<T>(selector: (state: DesignStoreState) => T): T {
  return useStore(designStore, selector);
}
