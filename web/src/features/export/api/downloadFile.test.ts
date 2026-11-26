import { describe, expect, it, vi } from 'vitest';
import type { ExportFile } from '../application/exportDesign';
import { downloadFile } from './downloadFile';

describe('downloadFile', () => {
  it('recusa caminho fora da lista fixa e não cria URL', () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    const evil = { path: '../../evil.sh', content: 'x' } as unknown as ExportFile;
    expect(downloadFile(evil)).toBe(false);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
