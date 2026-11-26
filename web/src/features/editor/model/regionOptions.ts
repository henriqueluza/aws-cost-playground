import { REGIONS, type Region } from '../../../shared/lib/design';

const REGION_PLACES: Readonly<Record<Region, string>> = {
  'us-east-1': 'N. Virgínia',
  'sa-east-1': 'São Paulo',
};

/** As regiões que o contrato aceita (PRD F6), com o lugar ao lado do código. Nada além disso. */
export const REGION_OPTIONS: readonly { readonly value: Region; readonly text: string }[] =
  REGIONS.map((value) => ({ value, text: `${value} · ${REGION_PLACES[value]}` }));

/** `null` se o texto não é uma região do contrato (valor vindo do DOM não é confiado). */
export function parseRegion(value: string): Region | null {
  return REGIONS.find((region) => region === value) ?? null;
}
