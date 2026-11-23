import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Declarações por contexto: contexto → propriedade → valor. */
export type CssDecls = Record<string, Record<string, string>>;

// Caminho de arquivo, não `URL`: no jsdom o `URL` global é o do jsdom, que o `fs` recusa.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Lê um arquivo pelo caminho a partir da raiz do repositório (ex.: `DESIGN.md`). */
export function readRepoFile(pathFromRepoRoot: string): string {
  return readFileSync(resolve(repoRoot, pathFromRepoRoot), 'utf8');
}

/** Junta o conteúdo de todos os blocos ```css de um Markdown, na ordem. */
export function designCssBlocks(markdown: string): string {
  return [...markdown.matchAll(/^```css\n([\s\S]*?)^```/gm)].map((m) => m[1]).join('\n');
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').replaceAll('"', "'").trim();

function addDecls(decls: CssDecls, context: string, body: string): void {
  if (!context) return; // nível superior: @import e afins não são declarações
  const target = (decls[context] ??= {});
  for (const decl of body.split(';')) {
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const prop = normalize(decl.slice(0, colon));
    // Repetida, a última venceria em silêncio e esconderia uma divergência.
    if (prop in target) throw new Error(`${prop} declarada duas vezes em ${context}`);
    target[prop] = normalize(decl.slice(colon + 1));
  }
}

/**
 * Lê as declarações de um CSS por contexto. O contexto é o seletor com espaços colapsados e
 * aspas simples, prefixado pela at-rule que o envolve (`@media (…) :root`). Blocos repetidos do
 * mesmo contexto são fundidos; propriedade repetida num contexto lança erro. Valores só têm espaços
 * colapsados e aspas duplas trocadas por simples, então uma diferença só de tipo de aspa não conta.
 * Feito para tokens e estilo base: não trata `;` nem `{` dentro de strings ou `url()`.
 */
export function parseCss(source: string): CssDecls {
  const decls: CssDecls = {};
  const contexts: string[] = [];
  let buffer = '';
  for (const char of source.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '{') {
      const cut = buffer.lastIndexOf(';') + 1;
      addDecls(decls, contexts.join(' '), buffer.slice(0, cut));
      contexts.push(normalize(buffer.slice(cut)));
      buffer = '';
    } else if (char === '}') {
      addDecls(decls, contexts.join(' '), buffer);
      contexts.pop();
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return decls;
}
