// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CatalogError, createCatalogLoader, type CatalogErrorKind } from '..';

type Bytes = Uint8Array<ArrayBuffer>;
type Files = Record<string, Bytes | undefined>;
const encode = (value: unknown): Bytes => new TextEncoder().encode(JSON.stringify(value));
const priceFile = (region: string, service: string, extra: object = {}) =>
  encode({ schemaVersion: 1, service, region, currency: 'USD', prices: [], ...extra });
const usFile = (service: string, extra?: object) => priceFile('us-east-1', service, extra);
const s3 = 'us-east-1/s3.json';

/** Catálogo em memória. `served` troca o que a porta entrega depois de o manifest ter o hash. */
function setup(files: Record<string, Bytes> = {}, served: Files = {}) {
  const listed = {
    'us-east-1/lambda.json': usFile('lambda'),
    [s3]: usFile('s3'),
    'sa-east-1/lambda.json': priceFile('sa-east-1', 'lambda'),
    ...files,
  };
  const manifest = encode({
    schemaVersion: 1,
    source: 'seed',
    generatedAt: '2026-11-23T12:00:00Z',
    files: Object.entries(listed).map(([path, bytes]) => ({
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })),
  });
  const store: Files = { 'manifest.json': manifest, ...listed, ...served };
  const read = vi.fn(async (path: string) => {
    const bytes = store[path];
    if (!bytes) throw new CatalogError('missing');
    return bytes;
  });
  return { read, loader: createCatalogLoader(read) };
}

describe('createCatalogLoader', () => {
  it('carrega só os serviços pedidos, na região pedida, e lê o manifest uma vez', async () => {
    const { read, loader } = setup();
    const us = await loader.load('us-east-1', ['lambda', 'lambda', 'rds']);
    expect([us.region, [...us.services.keys()]]).toEqual(['us-east-1', ['lambda']]);
    const sa = await loader.load('sa-east-1', ['lambda']);
    expect(sa.services.get('lambda')?.region).toBe('sa-east-1');
    expect(read.mock.calls.flat()).toEqual([
      'manifest.json',
      'us-east-1/lambda.json',
      'sa-east-1/lambda.json',
    ]);
    const { source, generatedAt } = await loader.manifest();
    expect([source, generatedAt]).toEqual(['seed', '2026-11-23T12:00:00Z']);
  });

  it.each<[string, CatalogErrorKind, Record<string, Bytes>, Files]>([
    ['hash diferente do manifest', 'integrity', {}, { [s3]: usFile('s3', { x: 1 }) }],
    ['arquivo fora do schema', 'invalid', { [s3]: usFile('s3', { currency: '<b>' }) }, {}],
    ['arquivo de outro serviço', 'invalid', { [s3]: usFile('lambda') }, {}],
    ['arquivo de outra região', 'invalid', { [s3]: priceFile('sa-east-1', 's3') }, {}],
    ['hash errado de conteúdo inválido', 'integrity', {}, { [s3]: encode({ nope: 1 }) }],
    ['arquivo listado que não existe', 'missing', {}, { [s3]: undefined }],
    ['manifest fora do schema', 'invalid', {}, { 'manifest.json': encode({ schemaVersion: 2 }) }],
    ['manifest que não é JSON', 'invalid', {}, { 'manifest.json': new Uint8Array([0xff, 0x7b]) }],
  ])('recusa %s com erro tipado de mensagem fixa', async (_name, kind, files, served) => {
    const { loader } = setup(files, served);
    const error = await loader.load('us-east-1', ['s3']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CatalogError);
    expect(error).toMatchObject({ kind, message: `Erro do catálogo de preços: ${kind}.` });
  });

  it('tenta o manifest de novo depois de uma falha da porta', async () => {
    const { read, loader } = setup();
    read.mockRejectedValueOnce(new CatalogError('network'));
    await expect(loader.manifest()).rejects.toMatchObject({ kind: 'network' });
    expect((await loader.load('us-east-1', ['s3'])).services.has('s3')).toBe(true);
  });
});
