import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { EditorPage } from './EditorPage';

it('o rodapé do editor leva às páginas legais (Issue #59)', () => {
  render(
    <MemoryRouter>
      <EditorPage />
    </MemoryRouter>,
  );
  const footer = screen.getByRole('contentinfo');
  const legal = within(footer).getByRole('navigation', { name: 'Informações legais' });
  const hrefs = within(legal)
    .getAllByRole('link')
    .map((a) => a.getAttribute('href'));
  expect(hrefs).toEqual(['/privacidade', '/termos']);
});
