import type { ReactElement } from 'react';
import type { CanvasCategory } from '../model/canvasModel';

/**
 * Ícones próprios, no estilo do Lucide (traço de 1,5px na grade de 16). O DESIGN.md pede o Lucide;
 * enquanto o pacote não é dependência do web, estes seis fazem o papel (sem ícone oficial da AWS).
 */
export type IconName = CanvasCategory | 'globe';

const SHAPES: Record<IconName, ReactElement> = {
  compute: (
    <>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
      <rect x="6" y="6" width="4" height="4" />
      <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" />
    </>
  ),
  data: (
    <>
      <ellipse cx="8" cy="3.5" rx="5" ry="2" />
      <path d="M3 3.5v9c0 1.1 2.24 2 5 2s5-.9 5-2v-9M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" />
    </>
  ),
  network: (
    <>
      <rect x="5.5" y="1.5" width="5" height="4" rx="1" />
      <rect x="1.5" y="10.5" width="4" height="4" rx="1" />
      <rect x="10.5" y="10.5" width="4" height="4" rx="1" />
      <path d="M8 5.5v2.5M3.5 10.5V8h9v2.5" />
    </>
  ),
  security: (
    <>
      <path d="M8 14.5s5.5-2 5.5-6.5V3L8 1.5 2.5 3v5c0 4.5 5.5 6.5 5.5 6.5Z" />
      <path d="m5.75 8 1.6 1.6 3-3.2" />
    </>
  ),
  ops: <path d="M14.5 8h-2.7l-2 5.5-3.6-11L4.2 8H1.5" />,
  globe: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M1.5 8h13M8 1.5c1.8 1.8 2.7 4 2.7 6.5S9.8 12.7 8 14.5C6.2 12.7 5.3 10.5 5.3 8S6.2 3.3 8 1.5Z" />
    </>
  ),
};

/** Ícone decorativo de 16px; o nome acessível vem do elemento que o contém. */
export function Icon({ name }: { name: IconName }): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
