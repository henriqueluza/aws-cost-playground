/**
 * Construtor tipado de HCL: o único caminho pelo qual texto chega a um arquivo `.tf`.
 * Os geradores de bloco montam nós com as funções de `hcl` e nunca concatenam texto. Toda string
 * vira literal escapado, todo identificador é conferido e todo número é formatado aqui, de modo
 * que rótulo, atributo ou uso vindos do design não conseguem abrir um bloco nem uma interpolação.
 */

export type HclValue =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'list'; readonly items: readonly HclValue[] }
  | { readonly kind: 'map'; readonly entries: readonly (readonly [string, HclValue])[] }
  | { readonly kind: 'ref'; readonly path: readonly (string | number)[] };

export type HclNode =
  | { readonly kind: 'attribute'; readonly name: string; readonly value: HclValue }
  | {
      readonly kind: 'block';
      readonly type: string;
      readonly labels: readonly string[];
      readonly body: readonly HclNode[];
    }
  | { readonly kind: 'comment'; readonly text: string };

/** Nó que o construtor recusa: identificador inválido, número não finito ou referência vazia. */
export class HclError extends Error {
  override readonly name = 'HclError';
}

export const hcl = {
  /** Literal entre aspas. É o único jeito de pôr texto do usuário num valor. */
  string: (value: string): HclValue => ({ kind: 'string', value }),
  number: (value: number): HclValue => ({ kind: 'number', value }),
  bool: (value: boolean): HclValue => ({ kind: 'bool', value }),
  list: (items: readonly HclValue[]): HclValue => ({ kind: 'list', items }),
  /** Objeto `{ "chave" = valor }`. As chaves saem sempre como literal entre aspas. */
  map: (entries: Readonly<Record<string, HclValue>>): HclValue => ({
    kind: 'map',
    entries: Object.entries(entries),
  }),
  /** Referência `a.b[0].c` ou palavra-chave de tipo (`string`). Cada parte é identificador ou índice. */
  ref: (...path: (string | number)[]): HclValue => ({ kind: 'ref', path }),
  attr: (name: string, value: HclValue): HclNode => ({ kind: 'attribute', name, value }),
  block: (type: string, labels: readonly string[], body: readonly HclNode[]): HclNode => ({
    kind: 'block',
    type,
    labels,
    body,
  }),
  /** Comentário de uma linha (`# ...`). Quebra de linha e fim de comentário de bloco são neutralizados. */
  comment: (text: string): HclNode => ({ kind: 'comment', text }),
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Controle (Cc), formato (Cf, inclui os marcadores bidi) e separadores de linha e de parágrafo. */
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const LONE_SURROGATE = /\p{Cs}/gu;
const SHORT_ESCAPES: Readonly<Record<string, string>> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
/** Maior módulo que sai com casas decimais sem perder precisão nem cair em notação exponencial. */
const MAX_DECIMAL = 1e15;

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new HclError('Identificador de HCL inválido.');
  return name;
}

function unicodeEscape(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  return code > 0xffff
    ? `\\U${code.toString(16).padStart(8, '0')}`
    : `\\u${code.toString(16).padStart(4, '0')}`;
}

/**
 * Literal de string do HCL. Escapa barra invertida e aspas, neutraliza `${` (interpolação) e `%{`
 * (diretiva de template), troca surrogate solto por U+FFFD e escreve como `\uNNNN` todo caractere
 * de controle ou de formato. O resto do Unicode sai como está: o arquivo é UTF-8.
 */
export function quoteHclString(value: string): string {
  const escaped = value
    .replace(LONE_SURROGATE, '�')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$\{/g, '$$${')
    .replace(/%\{/g, '%%{')
    .replace(UNSAFE_CHARS, (char) => SHORT_ESCAPES[char] ?? unicodeEscape(char));
  return `"${escaped}"`;
}

/**
 * Número em notação decimal, sem expoente: inteiro seguro como está, fração arredondada a 6 casas
 * (o que for menor que isso sai `0`). Serve para quantidade e capacidade; o export não escreve preço.
 */
export function formatHclNumber(value: number): string {
  if (!Number.isFinite(value)) throw new HclError('Número não finito.');
  if (Number.isSafeInteger(value)) return String(value === 0 ? 0 : value);
  if (Math.abs(value) >= MAX_DECIMAL) throw new HclError('Número fora da faixa.');
  const fixed = value.toFixed(6).replace(/\.?0+$/, '');
  return fixed === '-0' ? '0' : fixed;
}

/** Texto de comentário numa linha só: sem caractere de controle e sem fim de comentário de bloco. */
export function commentText(text: string): string {
  return text
    .replace(LONE_SURROGATE, '�')
    .replace(UNSAFE_CHARS, ' ')
    .replace(/\*\//g, '* /')
    .trimEnd();
}

function renderRef(path: readonly (string | number)[]): string {
  const [head, ...rest] = path;
  if (typeof head !== 'string') throw new HclError('Referência sem identificador inicial.');
  return rest.reduce<string>((text, part) => {
    if (typeof part === 'string') return `${text}.${identifier(part)}`;
    if (!Number.isSafeInteger(part) || part < 0) throw new HclError('Índice inválido.');
    return `${text}[${part}]`;
  }, identifier(head));
}

/** Valor que ocupa mais de uma linha: objeto com entradas, ou lista que contém um. */
const isMultiline = (value: HclValue): boolean =>
  value.kind === 'map'
    ? value.entries.length > 0
    : value.kind === 'list' && value.items.some(isMultiline);

function renderValue(value: HclValue, indent: string): string {
  switch (value.kind) {
    case 'string':
      return quoteHclString(value.value);
    case 'number':
      return formatHclNumber(value.value);
    case 'bool':
      return value.value ? 'true' : 'false';
    case 'ref':
      return renderRef(value.path);
    case 'list':
      // Lista numa linha só; um objeto dentro dela continua em várias linhas, no mesmo recuo.
      return `[${value.items.map((item) => renderValue(item, indent)).join(', ')}]`;
    case 'map': {
      if (value.entries.length === 0) return '{}';
      const inner = `${indent}  `;
      const lines = renderAssignments(
        value.entries.map(([key, entry]) => [quoteHclString(key), entry] as const),
        inner,
      );
      return `{\n${lines.join('\n')}\n${indent}}`;
    }
    default:
      // Dado que burlou os tipos (um `as`, um JSON): recusa em vez de escrever `undefined`.
      throw new HclError('Valor de HCL desconhecido.');
  }
}

/** Linhas `nome = valor` com o `=` alinhado, como o `terraform fmt`; valor de várias linhas fica isolado. */
function renderAssignments(
  pairs: readonly (readonly [string, HclValue])[],
  indent: string,
): string[] {
  const lines: string[] = [];
  let group: (readonly [string, HclValue])[] = [];
  const flush = () => {
    // Largura em pontos de código, não em unidades UTF-16: uma chave com emoji conta um por símbolo.
    const widths = group.map(([name]) => [...name].length);
    const width = Math.max(0, ...widths);
    group.forEach(([name, value], i) => {
      const padding = ' '.repeat(width - (widths[i] ?? 0));
      lines.push(`${indent}${name}${padding} = ${renderValue(value, indent)}`);
    });
    group = [];
  };
  for (const pair of pairs) {
    if (isMultiline(pair[1])) {
      flush();
      if (lines.length > 0 && lines.at(-1) !== '') lines.push('');
      lines.push(`${indent}${pair[0]} = ${renderValue(pair[1], indent)}`, '');
    } else {
      group.push(pair);
    }
  }
  flush();
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

function renderBody(nodes: readonly HclNode[], indent: string): string[] {
  const lines: string[] = [];
  let pending: (readonly [string, HclValue])[] = [];
  const separate = () => {
    if (lines.length > 0 && lines.at(-1) !== '') lines.push('');
  };
  const flush = () => {
    if (pending.length === 0) return;
    separate();
    lines.push(...renderAssignments(pending, indent));
    pending = [];
  };
  nodes.forEach((node, i) => {
    if (node.kind === 'attribute') {
      pending.push([identifier(node.name), node.value]);
      return;
    }
    flush();
    if (node.kind === 'comment') {
      // Comentários seguidos formam um parágrafo; o primeiro abre com uma linha em branco.
      if (nodes[i - 1]?.kind !== 'comment') separate();
      lines.push(`${indent}# ${commentText(node.text)}`.trimEnd());
      return;
    }
    if (nodes[i - 1]?.kind !== 'comment') separate();
    const labels = node.labels.map((label) => ` ${quoteHclString(identifier(label))}`).join('');
    const head = `${indent}${identifier(node.type)}${labels} {`;
    const body = renderBody(node.body, `${indent}  `);
    if (body.length === 0) lines.push(`${head}}`);
    else lines.push(head, ...body, `${indent}}`);
  });
  flush();
  return lines;
}

/** Texto do arquivo `.tf`: determinístico, com `\n` no fim e no formato do `terraform fmt`. */
export function renderHcl(nodes: readonly HclNode[]): string {
  return `${renderBody(nodes, '').join('\n')}\n`;
}
