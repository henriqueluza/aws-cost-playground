import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { designDocumentSchema } from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import { saveDesignDraft } from '../model/designDraft';
import { designStore } from './designStore';
import { keepDesignForLogin, useRestoreDesignDraft } from './designDraftSync';

const DOC = designDocumentSchema.parse(adrExampleDesign);
const EMPTY = { ...DOC, blocks: [], edges: [], workload: { description: '' } };

function Probe() {
  useRestoreDesignDraft();
  return null;
}

afterEach(() => {
  sessionStorage.clear();
  designStore.getState().loadDesign(EMPTY);
});

describe('design em edição e o login', () => {
  it('o design guardado antes do login volta ao editor, uma vez só (StrictMode)', () => {
    designStore.getState().loadDesign(DOC);
    keepDesignForLogin();
    designStore.getState().loadDesign(EMPTY); // a página recarregou
    expect(designStore.getState().document.blocks).toHaveLength(0);
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(designStore.getState().document).toEqual(DOC);
    expect(sessionStorage.length).toBe(0);
  });

  it('design vazio não é guardado', () => {
    designStore
      .getState()
      .loadDesign({ ...DOC, blocks: [], edges: [], workload: { description: '' } });
    keepDesignForLogin();
    expect(sessionStorage.length).toBe(0);
  });

  it('o template inicial intocado não é guardado e dá lugar ao rascunho', () => {
    designStore.getState().newDesign();
    keepDesignForLogin();
    expect(sessionStorage.length).toBe(0);
    saveDesignDraft(DOC);
    render(<Probe />);
    expect(designStore.getState().document).toEqual(DOC);
  });

  it('nunca troca o que a pessoa já tem na tela por um rascunho (e o rascunho some)', () => {
    designStore.getState().loadDesign(DOC);
    keepDesignForLogin();
    const edited = { ...DOC, region: 'sa-east-1' as const };
    designStore.getState().loadDesign(edited);
    render(<Probe />);
    expect(designStore.getState().document).toEqual(edited);
    expect(sessionStorage.length).toBe(0);
  });

  it('sem rascunho, o editor fica como está', () => {
    designStore.getState().loadDesign(DOC);
    render(<Probe />);
    expect(designStore.getState().document).toEqual(DOC);
  });
});
