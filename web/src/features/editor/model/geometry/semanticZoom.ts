/**
 * Zoom semântico do bloco (DESIGN.md, "Bloco no canvas"). Com o diagrama inteiro na tela o zoom cai
 * (0,35 em 1024 px) e o texto de 14 px viraria 5 px. Abaixo de um limiar o bloco passa ao modo
 * compacto (nome e valor) e o corpo do texto cresce na razão inversa do zoom, de modo que o que se
 * lê na tela fica em `TARGET_PX`, não importa o zoom. Funções puras: zoom entra, decisão sai.
 */

export type NodeDetail = 'full' | 'compact';

/** Corpo do nome do bloco no modo completo, em px do canvas (token `--fs-body`). */
export const BODY_PX = 14;
/** Corpo alvo, em px de tela, do nome e do valor no modo compacto. */
export const TARGET_PX = 10.5;
/** Abaixo deste zoom o bloco passa ao modo compacto; acima de `LEAVE_ABOVE` volta ao completo. */
export const ENTER_BELOW = 0.74;
export const LEAVE_ABOVE = 0.82;
/** Teto da ampliação: acima disso o texto não cabe nos 216 x 94 px do bloco. */
export const MAX_SCALE = 2;
/** Até esta ampliação o nome cabe em duas linhas; acima, em uma. */
export const TWO_LINES_UP_TO = 1.6;

/**
 * Modo do bloco para o zoom atual. A histerese (entra abaixo de 0,74, volta acima de 0,82) evita o
 * pisca-pisca de quem para o zoom perto do limiar; entre os dois vale o modo anterior.
 */
export function nodeDetail(zoom: number, previous: NodeDetail): NodeDetail {
  if (zoom < ENTER_BELOW) return 'compact';
  if (zoom > LEAVE_ABOVE) return 'full';
  return previous;
}

/**
 * Ampliação do texto compacto: a que deixa o corpo na tela em `TARGET_PX`, entre 1 e `MAX_SCALE`.
 * Em 0,75 ou mais vale 1 (o 14 px do canvas já passa de 10,5 px na tela). Arredondada a 0,01.
 */
export function compactScale(zoom: number): number {
  if (!(zoom > 0)) return MAX_SCALE;
  const scale = TARGET_PX / (BODY_PX * zoom);
  return Math.round(Math.min(MAX_SCALE, Math.max(1, scale)) * 100) / 100;
}

/** Linhas do nome no modo compacto, para a altura do bloco não estourar. */
export function nameLines(scale: number): 1 | 2 {
  return scale <= TWO_LINES_UP_TO ? 2 : 1;
}

/** Corpo do nome do bloco na tela (px), para o teste e para o relatório. */
export function effectiveBodyPx(zoom: number, detail: NodeDetail): number {
  return BODY_PX * (detail === 'compact' ? compactScale(zoom) : 1) * zoom;
}
