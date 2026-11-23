/*
 * Tema antes da primeira pintura (DESIGN.md, "Como o tema é escolhido"). Script clássico no
 * <head>, sem defer: não é módulo e não deixa globais. Grava data-theme ('light' | 'dark') em
 * <html> com a escolha válida de localStorage['acp-theme'] ou, sem ela, com
 * '(prefers-color-scheme: dark)', acompanhado enquanto não houver escolha. Sem matchMedia: 'light'.
 */
(() => {
  'use strict';
  const saved = () => {
    try {
      const value = window.localStorage.getItem('acp-theme');
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      // Storage bloqueado (cookies desligados, iframe de terceiro) lança SecurityError no getter
      // ou no getItem. O tema precisa sair mesmo assim, então a falha conta como sem escolha.
      return null;
    }
  };
  const apply = (dark) =>
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  const choice = saved();
  apply(choice ? choice === 'dark' : query?.matches);
  // A escolha pode ser salva depois da carga: cada evento relê o storage; com escolha, nada muda.
  query?.addEventListener?.('change', (event) => {
    if (!saved()) apply(event?.matches ?? query.matches);
  });
})();
