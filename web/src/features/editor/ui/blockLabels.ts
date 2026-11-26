import type { AttributeValue } from '../model/blockForm';

/** Rótulos pt-BR do contrato (chaves em inglês). `blockLabels.test.ts` falha se faltar algum. */
export const ATTRIBUTE_LABELS: Readonly<Record<string, string>> = {
  architecture: 'Arquitetura',
  memoryMb: 'Memória',
  storageClass: 'Classe de armazenamento',
  queueType: 'Tipo de fila',
  capacityMode: 'Modo de capacidade',
  instanceType: 'Tipo de instância',
  az: 'Zona de disponibilidade',
  engine: 'Mecanismo',
  instanceClass: 'Classe da instância',
  deployment: 'Implantação',
  nodeType: 'Tipo de nó',
  tier: 'Nível',
  pipelineType: 'Tipo de pipeline',
};

/** Atributos cujas opções são nomes técnicos da AWS, exibidos como estão (`t3.small`). */
const RAW_OPTION_KEYS: ReadonlySet<string> = new Set([
  'instanceType',
  'instanceClass',
  'nodeType',
  'architecture',
  'storageClass',
]);

const OPTION_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  queueType: { standard: 'Padrão', fifo: 'FIFO' },
  capacityMode: { 'on-demand': 'Sob demanda', provisioned: 'Provisionada' },
  az: { a: 'Zona A', b: 'Zona B', c: 'Zona C' },
  engine: { postgres: 'PostgreSQL', mysql: 'MySQL', redis: 'Redis', memcached: 'Memcached' },
  deployment: { 'single-az': 'Uma zona', 'multi-az': 'Várias zonas' },
  tier: { lite: 'Lite', essentials: 'Essentials', plus: 'Plus' },
  pipelineType: { V1: 'V1', V2: 'V2' },
};

export const USAGE_LABELS: Readonly<Record<string, string>> = {
  requestsPerMonth: 'Requisições por mês',
  avgDurationMs: 'Duração média',
  storageGb: 'Armazenamento',
  putRequestsPerMonth: 'Requisições PUT por mês',
  getRequestsPerMonth: 'Requisições GET por mês',
  readRequestsPerMonth: 'Leituras por mês',
  writeRequestsPerMonth: 'Escritas por mês',
  provisionedReadUnits: 'Leitura provisionada',
  provisionedWriteUnits: 'Escrita provisionada',
  instanceCount: 'Instâncias',
  hoursPerMonth: 'Horas por mês',
  rootVolumeGb: 'Volume raiz',
  backupStorageGb: 'Armazenamento de backup',
  nodeCount: 'Nós',
  newConnectionsPerSecond: 'Novas conexões por segundo',
  activeConnectionsPerMinute: 'Conexões ativas por minuto',
  processedGbPerMonth: 'Dados processados por mês',
  ruleEvaluationsPerSecond: 'Avaliações de regra por segundo',
  logsIngestedGbPerMonth: 'Logs ingeridos por mês',
  logsStoredGb: 'Logs armazenados',
  customMetrics: 'Métricas personalizadas',
  gbPerMonth: 'Volume de dados por mês',
  alarms: 'Alarmes',
  webAcls: 'ACLs web',
  rules: 'Regras',
  monthlyActiveUsers: 'Usuários ativos por mês',
  secrets: 'Segredos',
  apiCallsPerMonth: 'Chamadas de API por mês',
  trails: 'Trilhas',
  managementEventsPerMonth: 'Eventos de gerenciamento por mês',
  dataEventsPerMonth: 'Eventos de dados por mês',
  hostedZones: 'Zonas hospedadas',
  queriesPerMonth: 'Consultas por mês',
  activePipelines: 'Pipelines ativos',
  executionMinutesPerMonth: 'Minutos de execução por mês',
};

/** Unidade do contrato (`unit`) como aparece dentro do campo. */
export const UNIT_LABELS: Readonly<Record<string, string>> = {
  GB: 'GB',
  RCU: 'RCU',
  WCU: 'WCU',
  ms: 'ms',
  requests: 'requisições',
  alarms: 'alarmes',
  'connections/min': 'conexões/min',
  'connections/s': 'conexões/s',
  'evaluations/s': 'avaliações/s',
  events: 'eventos',
  'hosted zones': 'zonas',
  hours: 'horas',
  instances: 'instâncias',
  metrics: 'métricas',
  minutes: 'minutos',
  nodes: 'nós',
  pipelines: 'pipelines',
  queries: 'consultas',
  rules: 'regras',
  secrets: 'segredos',
  trails: 'trilhas',
  users: 'usuários',
  'web ACLs': 'ACLs',
};

const number = new Intl.NumberFormat('pt-BR');

/** Só chave própria: `constructor` e afins não resolvem para função do protótipo. */
const own = (map: Readonly<Record<string, string>> | undefined, key: string) =>
  map !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;

export const attributeLabel = (key: string): string | undefined => own(ATTRIBUTE_LABELS, key);
export const usageLabel = (key: string): string | undefined => own(USAGE_LABELS, key);
export const unitLabel = (unit: string): string | undefined => own(UNIT_LABELS, unit);

export function optionLabel(key: string, option: AttributeValue): string | undefined {
  if (key === 'memoryMb' && typeof option === 'number') return `${number.format(option)} MB`;
  if (typeof option !== 'string') return undefined;
  if (RAW_OPTION_KEYS.has(key)) return option;
  return Object.hasOwn(OPTION_LABELS, key) ? own(OPTION_LABELS[key], option) : undefined;
}

export const formatRangeNumber = (value: number): string => number.format(value);
