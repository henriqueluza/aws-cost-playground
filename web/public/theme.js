/*
 * Grava data-theme no <html> antes da primeira pintura: usa a escolha salva em localStorage
 * ('acp-theme') ou, sem ela, prefers-color-scheme, e acompanha o sistema enquanto não houver
 * escolha. Arquivo separado, nunca inline, para a CSP não precisar de 'unsafe-inline'.
 */
(() => {
  const savedTheme = () => {
    try {
      const value = window.localStorage.getItem('acp-theme');
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null; // Storage bloqueado (Safari privado, política do navegador): sem escolha.
    }
  };

  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
  };

  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  apply(savedTheme() ?? (media && media.matches ? 'dark' : 'light'));

  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', (event) => {
      if (savedTheme() === null) apply(event.matches ? 'dark' : 'light');
    });
  }
})();
