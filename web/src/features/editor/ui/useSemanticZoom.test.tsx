import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { useSemanticZoom } from './useSemanticZoom';

const holder: { store: ReturnType<typeof useStoreApi> | null } = { store: null };
const setZoom = (zoom: number) => act(() => holder.store?.setState({ transform: [0, 0, zoom] }));

function Probe() {
  const store = useStoreApi();
  useEffect(() => {
    holder.store = store;
  }, [store]);
  const { detail, style } = useSemanticZoom();
  return <div data-testid="probe" data-detail={detail} style={style} />;
}

const probe = () => screen.getByTestId('probe');

describe('useSemanticZoom', () => {
  it('com o zoom de 1 o bloco é completo e a ampliação é 1', () => {
    render(
      <ReactFlowProvider>
        <Probe />
      </ReactFlowProvider>,
    );
    expect(probe()).toHaveAttribute('data-detail', 'full');
    expect(probe().style.getPropertyValue('--node-scale')).toBe('1');
  });

  it('abaixo do limiar vira compacto, com o corpo ampliado e o nome em duas linhas', () => {
    render(
      <ReactFlowProvider>
        <Probe />
      </ReactFlowProvider>,
    );
    setZoom(0.47);
    expect(probe()).toHaveAttribute('data-detail', 'compact');
    expect(Number(probe().style.getPropertyValue('--node-scale'))).toBeCloseTo(1.6, 1);
    expect(probe().style.getPropertyValue('--name-lines')).toBe('2');
    setZoom(0.3);
    expect(probe().style.getPropertyValue('--name-lines')).toBe('1');
  });

  it('a histerese segura o modo entre os dois limiares', () => {
    render(
      <ReactFlowProvider>
        <Probe />
      </ReactFlowProvider>,
    );
    setZoom(0.4);
    setZoom(0.78);
    expect(probe()).toHaveAttribute('data-detail', 'compact');
    setZoom(0.9);
    expect(probe()).toHaveAttribute('data-detail', 'full');
    setZoom(0.78);
    expect(probe()).toHaveAttribute('data-detail', 'full');
  });
});
