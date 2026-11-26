import { Position, ReactFlowProvider } from '@xyflow/react';
import type { ComponentProps } from 'react';
import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EdgeKind } from '../../../shared/lib/design';
import { STROKE_CLASS, TypedEdge } from './TypedEdge';

// O vitest roda em `web/`; o CSS é lido como texto porque o jsdom não calcula estilo.
const css = readFileSync('src/features/editor/ui/CanvasPanel.module.css', 'utf8');
const KINDS: EdgeKind[] = ['data', 'runs-on', 'logs'];

function draw(kind: EdgeKind, selected = false, route?: { centerX: number }, targetX = 200) {
  const props = {
    id: 'edg_1',
    source: 'a',
    target: 'b',
    sourceX: 0,
    sourceY: 0,
    targetX,
    targetY: 80,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    selected,
    data: { kind, route },
  } as unknown as ComponentProps<typeof TypedEdge>;
  return render(
    <ReactFlowProvider>
      <svg>
        <TypedEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  );
}

describe('TypedEdge: corredor próprio', () => {
  it('o trecho vertical passa no x do corredor planejado, não no meio', () => {
    const vertical = (route?: { centerX: number }) =>
      draw('data', false, route)
        .container.querySelector('path.react-flow__edge-path')
        ?.getAttribute('d');
    expect(vertical()).toContain('100');
    expect(vertical({ centerX: 30 })).toContain('L 30,');
    expect(vertical({ centerX: 30 })).not.toBe(vertical());
  });

  it('em corredor estreito (menos de 40 px) o trecho vertical ainda cai na faixa, sem zigue-zague', () => {
    const d =
      draw('data', false, { centerX: 12 }, 28)
        .container.querySelector('path.react-flow__edge-path')
        ?.getAttribute('d') ?? '';
    const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?),/g)].map((m) => Number(m[1]));
    expect(xs).toContain(12);
    // monótono: o traçado só anda para a direita
    expect(xs.every((x, i) => i === 0 || x >= xs[i - 1]!)).toBe(true);
  });
});

describe('TypedEdge: o traçado diz o tipo', () => {
  it.each(KINDS)('%s desenha o caminho com a classe do tipo', (kind) => {
    const { container } = draw(kind);
    const path = container.querySelector('path.react-flow__edge-path');
    expect(STROKE_CLASS[kind]).toBeTruthy();
    expect(path).toHaveClass(STROKE_CLASS[kind]);
  });

  it('as três classes são diferentes', () => {
    expect(new Set(KINDS.map((k) => STROKE_CLASS[k])).size).toBe(3);
  });

  it('o CSS dá a cada tipo um traçado: contínuo, tracejado 6 4 e pontilhado 1,5 4 de ponta redonda', () => {
    const rule = (name: string) => new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('strokeData')).toContain('stroke-dasharray: none');
    expect(rule('strokeRunsOn')).toContain('stroke-dasharray: var(--dash-runs-on)');
    expect(rule('strokeLogs')).toContain('stroke-dasharray: var(--dash-logs)');
    expect(rule('strokeLogs')).toContain('stroke-linecap: round');
    expect(css).toContain('--dash-runs-on: 6 4');
    expect(css).toContain('--dash-logs: 1.5 4');
  });

  it('selecionada: ganha os dois pontos de ponta', () => {
    expect(draw('data').container.querySelectorAll('circle')).toHaveLength(0);
    expect(draw('data', true).container.querySelectorAll('circle')).toHaveLength(2);
  });
});
