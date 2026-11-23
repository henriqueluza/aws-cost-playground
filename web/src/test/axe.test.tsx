import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from './axe';

describe('expectNoAxeViolations', () => {
  it('passa para um botão com nome', async () => {
    const { container } = render(<button type="button">Salvar</button>);
    await expectNoAxeViolations(container);
  });

  it('falha para um botão sem nome acessível', async () => {
    const { container } = render(<button type="button" />);
    await expect(expectNoAxeViolations(container)).rejects.toThrow();
  });
});
