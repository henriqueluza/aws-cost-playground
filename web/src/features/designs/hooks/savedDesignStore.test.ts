import { describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import type { DesignDocument } from '../../../shared/lib/design';
import { createSavedDesignStore } from './savedDesignStore';

const saved = (name: string) => ({
  id: 'd1',
  name,
  version: 1,
  doc: adrExampleDesign as unknown as DesignDocument,
});

describe('savedDesignStore: vínculo com o design salvo', () => {
  it('um envio que termina depois de o vínculo mudar é descartado', () => {
    const s = createSavedDesignStore();
    s.getState().begin();
    const { epoch } = s.getState();
    s.getState().unlink();
    expect(s.getState().finish(saved('A'), epoch)).toBe(false);
    expect(s.getState().saved).toBeNull();
    expect(s.getState().saving).toBe(false);
  });

  it('abrir outro design também invalida o envio em andamento', () => {
    const s = createSavedDesignStore();
    s.getState().begin();
    const { epoch } = s.getState();
    s.getState().setSaved(saved('B'));
    expect(s.getState().finish(saved('A'), epoch)).toBe(false);
    expect(s.getState().saved?.name).toBe('B');
  });

  it('sem mudança no meio, o envio grava o resultado', () => {
    const s = createSavedDesignStore();
    s.getState().begin();
    expect(s.getState().finish(saved('A'), s.getState().epoch)).toBe(true);
    expect(s.getState().saved?.name).toBe('A');
  });
});
