import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { MARKERS, splitMarkers } from '../model/document';
import { privacyPolicy } from '../model/privacy';
import { termsOfUse } from '../model/terms';
import { PrivacyPage } from './PrivacyPage';
import { TermsPage } from './TermsPage';

function renderAt(path: string) {
  const Page = path === '/privacidade' ? PrivacyPage : TermsPage;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Page />
    </MemoryRouter>,
  );
}

const pages = [
  ['/privacidade', privacyPolicy],
  ['/termos', termsOfUse],
] as const;

describe.each(pages)('%s', (path, doc) => {
  it('tem h1 único, índice com âncoras e uma seção por item', () => {
    const { container } = renderAt(path);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const toc = screen.getByRole('navigation', { name: 'Nesta página' });
    for (const s of doc.sections) {
      const link = within(toc).getByRole('link', { name: s.heading });
      expect(link).toHaveAttribute('href', `#${s.id}`);
      expect(container.querySelector(`h2#${s.id}`)).toHaveTextContent(s.heading);
    }
  });

  it('define o título da aba e o restaura ao sair', () => {
    document.title = 'antes';
    const { unmount } = renderAt(path);
    expect(document.title).toBe(`${doc.title} · AWS Cost Playground`);
    unmount();
    expect(document.title).toBe('antes');
  });

  it('avisa que é rascunho, tem rodapé com links legais e não tem violação de acessibilidade', async () => {
    const { container } = renderAt(path);
    expect(screen.getByRole('status')).toHaveTextContent('Rascunho');
    const legal = screen.getByRole('navigation', { name: 'Informações legais' });
    const privacy = within(legal).getByRole('link', { name: 'Privacidade' });
    expect(privacy).toHaveAttribute('href', '/privacidade');
    await expectNoAxeViolations(container);
  });

  it('destaca como texto só os marcadores listados em MARKERS', () => {
    const { container } = renderAt(path);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) expect(Object.values(MARKERS)).toContain(m.textContent);
  });
});

describe('conteúdo exigido pela Issue #59, na seção certa', () => {
  it.each([
    ['/privacidade', 'dados', 'O único dado pessoal que o serviço pede é o seu e-mail.'],
    ['/privacidade', 'dados', 'Ele é enviado à Claude API, da Anthropic'],
    ['/privacidade', 'finalidades', 'Criar e manter a sua conta, e salvar e abrir os seus designs'],
    ['/privacidade', 'finalidades', 'Gerar a estimativa de uso a partir da sua descrição de carga'],
    ['/privacidade', 'transferencia', 'A infraestrutura fica na região us-east-1 da AWS'],
    ['/privacidade', 'retencao', 'E-mail e senha: até você excluir a conta.'],
    ['/privacidade', 'retencao', 'Registros técnicos: 7 dias.'],
    ['/privacidade', 'direitos', 'Excluir a sua conta: use a opção de exclusão na página Conta.'],
    ['/privacidade', 'controlador', `assunto de privacidade: ${MARKERS.contact}.`],
    ['/privacidade', 'aviso-descricao', 'Não escreva nomes, e-mails, documentos'],
    ['/termos', 'estimativa', 'Os valores mostrados são uma estimativa, não uma cotação oficial.'],
    ['/termos', 'garantia', 'O serviço é oferecido como está, sem garantia'],
    ['/termos', 'descricao-de-carga', 'Não inclua dado pessoal nela nem nos rótulos dos blocos.'],
  ])('%s, seção #%s: "%s"', (path, id, needle) => {
    const { container } = renderAt(path);
    expect(container.querySelector(`section[aria-labelledby="${id}"]`)).toHaveTextContent(needle);
  });
});

describe('splitMarkers', () => {
  it('separa marcadores e preserva o texto', () => {
    expect(splitMarkers('a [X] b')).toEqual([
      { text: 'a ', marker: false },
      { text: '[X]', marker: true },
      { text: ' b', marker: false },
    ]);
  });
});
