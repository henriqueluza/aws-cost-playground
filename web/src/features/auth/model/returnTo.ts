const MAX_LENGTH = 512;
/** Origem fictícia, só para resolver o caminho; nunca se navega para ela. */
const BASE = 'https://app.invalid';
/** Barra invertida (que o navegador lê como `/`) ou caractere de controle. */
const UNSAFE_CHARS = /[\\\p{Cc}]/u;

/** `true` para `/auth` e o que está abaixo, como o roteador o lê: decodificado e sem diferenciar caixa. */
function isAuthPath(pathname: string): boolean {
  try {
    const path = decodeURIComponent(pathname).toLowerCase();
    return path === '/auth' || path.startsWith('/auth/');
  } catch {
    return true;
  }
}

/**
 * Para onde voltar depois do login: um caminho interno do site, ou `/`.
 * Aceita só string de até 512 caracteres que começa com uma única `/`, sem `\` nem caractere de
 * controle, que resolve na mesma origem e não cai em `/auth/` (voltar ao callback repetiria a
 * troca do código). Devolve o caminho já normalizado, com query e fragmento.
 */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > MAX_LENGTH) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || UNSAFE_CHARS.test(raw)) return '/';
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE || url.pathname.startsWith('//') || isAuthPath(url.pathname)) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
