import { createRequire } from 'node:module';
import { expect, type Page } from '@playwright/test';

/** O `axe-core` que já é dependência do projeto, injetado na página (não há `@axe-core/playwright`). */
const AXE_SCRIPT = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const THEMES = ['light', 'dark'] as const;
const BLOCKING = new Set(['serious', 'critical']);

type Violation = { id: string; impact?: string | null; nodes: { target: unknown }[] };
type AxeWindow = { axe?: { run: () => Promise<{ violations: Violation[] }> } };

/**
 * Audita a tela atual com o axe nos temas claro e escuro e falha se houver violação séria ou
 * crítica. No navegador de verdade o contraste é calculado, ao contrário do axe do jsdom.
 */
export async function expectNoSeriousA11yViolations(page: Page, screen: string): Promise<void> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE_SCRIPT });
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const violations = await page.evaluate(async () => {
      // A troca de tema anima as cores: medir no meio da transição dá contraste falso.
      await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
      const { axe } = window as unknown as AxeWindow;
      if (!axe) throw new Error('axe-core não foi carregado na página');
      return (await axe.run()).violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) => node.target),
      }));
    });
    const blocking = violations.filter((v) => BLOCKING.has(v.impact ?? ''));
    expect(blocking, `axe em "${screen}", tema ${theme}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}
