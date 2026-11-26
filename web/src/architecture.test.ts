// @vitest-environment node
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

async function errorRules(code: string, file: string): Promise<string[]> {
  const filePath = fileURLToPath(new URL(file, import.meta.url));
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? '');
}

const reactImport = "import { useState } from 'react';\nexport const hook = useState;\n";
const designsUi = './features/designs/ui/x.tsx';
const designLib = './shared/lib/design/x.ts';
const moneyLib = './shared/lib/money.ts';
const apiLib = './shared/lib/api/x.ts';

describe('arquitetura do web (ADR-0001)', { timeout: 30_000 }, () => {
  it('proíbe react em model/', async () => {
    const rules = await errorRules(reactImport, './features/pricing/model/x.ts');
    expect(rules).toContain('no-restricted-imports');
  });

  it.each([
    ["import { useState } from 'react';", './features/pricing/application/x.ts'],
    ["import { createRoot } from 'react-dom/client';", './features/pricing/model/x.ts'],
    ["import { ReactFlow } from '@xyflow/react';", './features/pricing/application/x.ts'],
    ["import { get } from '../../../shared/lib/http';", './features/pricing/model/x.ts'],
    ["import { get } from '../../../shared/lib/http';", './features/pricing/application/x.ts'],
    ["import { useState } from 'react';", designLib],
    ["import { ReactFlow } from '@xyflow/react';", designLib],
    ["import { get } from '../../../shared/lib/http';", designLib],
    ["import { get } from '../http';", designLib],
    ["import { get } from '../http';", './features/pricing/model/x.ts'],
    ["import { get } from '../../lib/http';", designLib],
    ["import { useState } from 'react';", moneyLib],
    ["import { ReactFlow } from '@xyflow/react';", moneyLib],
    ["import { get } from './http';", moneyLib],
    ["import { useState } from 'react';", apiLib],
    ["import { ReactFlow } from '@xyflow/react';", apiLib],
    ["import { get } from '../http';", apiLib],
  ])('proíbe %s em %s', async (line, file) => {
    const rules = await errorRules(`${line}\nexport const dep = 1;\n`, file);
    expect(rules).toContain('no-restricted-imports');
  });

  it('permite react em ui/', async () => {
    const rules = await errorRules(reactImport, './features/pricing/ui/x.tsx');
    expect(rules).not.toContain('no-restricted-imports');
  });

  it('permite zod em shared/lib/api', async () => {
    const code = "import { z } from 'zod';\nexport const s = z.string();\n";
    const rules = await errorRules(code, apiLib);
    expect(rules).not.toContain('no-restricted-imports');
  });

  it('permite a pricing/api importar a porta de application/ e o contrato de shared', async () => {
    const code =
      "import { CatalogError } from '../application/loadCatalog';\nimport { REGIONS } from '../../../shared/lib/design';\nexport const deps = [CatalogError, REGIONS];\n";
    expect(await errorRules(code, './features/pricing/api/x.ts')).toEqual([]);
  });

  it('permite a pricing/hooks usar React, TanStack Query e as camadas de dentro', async () => {
    const code =
      "import { useQuery } from '@tanstack/react-query';\nimport { useMemo } from 'react';\nimport { httpPriceFiles } from '../api/httpPriceFiles';\nimport { catalogServices } from '../application/catalogServices';\nexport const deps = [useQuery, useMemo, httpPriceFiles, catalogServices];\n";
    expect(await errorRules(code, './features/pricing/hooks/x.ts')).toEqual([]);
  });

  it('proíbe outra feature de importar o adaptador de pricing/api direto', async () => {
    const code =
      "import { httpPriceFiles } from '../../pricing/api/httpPriceFiles';\nexport const p = httpPriceFiles;\n";
    expect(await errorRules(code, designsUi)).toContain('boundaries/dependencies');
  });

  it('proíbe importar um arquivo interno de outra feature', async () => {
    const code =
      "import { EditorPage } from '../../editor/ui/EditorPage';\nexport const p = EditorPage;\n";
    expect(await errorRules(code, designsUi)).toContain('boundaries/dependencies');
  });

  it('proíbe shared/lib/design de importar uma feature', async () => {
    const code = "import { PricingPanel } from '../../../features/pricing';\nexport const p = 1;\n";
    expect(await errorRules(code, designLib)).toContain('boundaries/dependencies');
  });

  it('permite importar outra feature pelo index.ts', async () => {
    const code = "import { EditorPage } from '../../editor';\nexport const p = EditorPage;\n";
    const rules = await errorRules(code, designsUi);
    expect(rules.filter((id) => id.startsWith('boundaries/'))).toEqual([]);
  });
});
