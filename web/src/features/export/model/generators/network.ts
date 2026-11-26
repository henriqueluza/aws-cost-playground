import type { BlockType } from '../../../pricing';
import type { ExportBlock, GeneratorInput, GeneratorOutput } from '../generator';
import { hcl, type HclNode, type HclValue } from '../hcl';

/**
 * Rede compartilhada dos blocos em VPC: VPC, sub-redes, rotas e security groups, emitidos uma vez
 * por design. Quem emite é o primeiro bloco, na ordem do id, cujo tipo está em `NETWORK_OWNERS`;
 * os nomes dos recursos são fixos, então os demais blocos só os referenciam.
 */

export const AZ_LETTERS = ['a', 'b', 'c'] as const;
export type AzLetter = (typeof AZ_LETTERS)[number];
export type SubnetTier = 'public' | 'private';
/** Papéis de security group: um grupo por papel, não por bloco. */
export type NetworkRole = 'alb' | 'app' | 'db' | 'cache';

/** Bloco CIDR privado (RFC 1918) fixo da VPC; cada sub-rede é um /24 dele, fixo por zona. */
export const VPC_CIDR = '10.0.0.0/16';
const SUBNET_OCTET = { public: 0, private: 10 } as const satisfies Record<SubnetTier, number>;
const ANY_IPV4 = '0.0.0.0/0';
/** Porta em que as instâncias atendem o ALB; o TLS termina no ALB. */
export const APP_PORT = 80;

/** Tipos cujo gerador emite a rede. Cresce a cada gerador de bloco em VPC entregue. */
const NETWORK_OWNERS: readonly BlockType[] = ['aws.ec2'];
/** Tipos que escolhem zona pelo atributo `az` do contrato. */
const ZONED: readonly BlockType[] = ['aws.ec2', 'aws.rds', 'aws.elasticache'];
const ROLE_OF: Partial<Record<BlockType, NetworkRole>> = {
  'aws.alb': 'alb',
  'aws.ec2': 'app',
  'aws.rds': 'db',
  'aws.elasticache': 'cache',
};
const ROLE_TEXT: Record<NetworkRole, string> = {
  alb: 'Balanceadores de carga: entrada da internet.',
  app: 'Instâncias de aplicação.',
  db: 'Bancos de dados: só a aplicação entra.',
  cache: 'Caches: só a aplicação entra.',
};
/** Pares de papéis que podem se falar. Outro par (ALB direto no banco, por exemplo) nunca é aberto. */
const CHAIN: readonly (readonly [NetworkRole, NetworkRole])[] = [
  ['alb', 'app'],
  ['app', 'db'],
  ['app', 'cache'],
];
const DB_PORTS = { postgres: 5432, mysql: 3306 } as const;
const CACHE_PORTS = { redis: 6379, memcached: 11211 } as const;

/** Zona do bloco: o atributo `az` do contrato; sem ele, a zona `a`. */
export function blockAz(block: ExportBlock): AzLetter {
  return AZ_LETTERS.find((letter) => letter === block.attributes.az) ?? 'a';
}

/**
 * Zonas do design, em ordem: as dos blocos com zona, completadas até duas. O ALB e os grupos de
 * sub-redes do RDS e do ElastiCache exigem pelo menos duas zonas.
 */
export function designAzs(blocks: readonly ExportBlock[]): readonly AzLetter[] {
  const used = new Set(blocks.filter((block) => ZONED.includes(block.type)).map(blockAz));
  for (const letter of AZ_LETTERS) if (used.size < 2) used.add(letter);
  return AZ_LETTERS.filter((letter) => used.has(letter));
}

export const subnetId = (tier: SubnetTier, az: AzLetter): HclValue =>
  hcl.ref('aws_subnet', `${tier}_${az}`, 'id');
export const subnetIds = (tier: SubnetTier, blocks: readonly ExportBlock[]): HclValue =>
  hcl.list(designAzs(blocks).map((az) => subnetId(tier, az)));
export const securityGroupId = (role: NetworkRole): HclValue =>
  hcl.ref('aws_security_group', role, 'id');
export const VPC_ID = hcl.ref('aws_vpc', 'main', 'id');

const resource = (type: string, name: string, body: readonly HclNode[]): HclNode =>
  hcl.block('resource', [type, name], body);

/** Nome real da zona: a região do provider mais a letra, sem interpolação escrita à mão. */
const zoneName = (az: AzLetter): HclValue =>
  hcl.call('format', [hcl.string('%s%s'), hcl.ref('var', 'aws_region'), hcl.string(az)]);

function subnetNodes(az: AzLetter): HclNode[] {
  const subnet = (tier: SubnetTier) =>
    resource('aws_subnet', `${tier}_${az}`, [
      hcl.attr('vpc_id', VPC_ID),
      hcl.attr(
        'cidr_block',
        hcl.string(`10.0.${SUBNET_OCTET[tier] + AZ_LETTERS.indexOf(az)}.0/24`),
      ),
      hcl.attr('availability_zone', zoneName(az)),
      hcl.attr('map_public_ip_on_launch', hcl.bool(false)),
    ]);
  const association = (tier: SubnetTier, table: string) =>
    resource('aws_route_table_association', `${tier}_${az}`, [
      hcl.attr('subnet_id', subnetId(tier, az)),
      hcl.attr('route_table_id', hcl.ref('aws_route_table', table, 'id')),
    ]);
  return [
    subnet('public'),
    association('public', 'public'),
    subnet('private'),
    // Uma tabela privada por zona: sem bloco de NAT Gateway ela não tem rota de saída.
    resource('aws_route_table', `private_${az}`, [hcl.attr('vpc_id', VPC_ID)]),
    association('private', `private_${az}`),
  ];
}

/** Pares de papéis ligados por aresta `data`; sem nenhuma aresta dessas, vale a cadeia inteira. */
function connectedPairs(input: GeneratorInput): ReadonlySet<string> {
  const pairs = new Set<string>();
  for (const block of input.blocks) {
    const from = ROLE_OF[block.type];
    for (const link of input.designLinks.get(block.id) ?? []) {
      const to = link.peer && ROLE_OF[link.peer.type];
      if (link.kind !== 'data' || !from || !to) continue;
      for (const [a, b] of CHAIN) {
        if ((a === from && b === to) || (a === to && b === from)) pairs.add(`${a}-${b}`);
      }
    }
  }
  return pairs.size > 0 ? pairs : new Set(CHAIN.map(([a, b]) => `${a}-${b}`));
}

type Peer = { readonly role: NetworkRole } | { readonly cidr: typeof ANY_IPV4 };

/** Regra de security group como recurso separado, sempre TCP numa porta só. */
function rule(
  direction: 'ingress' | 'egress',
  name: string,
  role: NetworkRole,
  port: number,
  peer: Peer,
  description: string,
): HclNode {
  return resource(`aws_vpc_security_group_${direction}_rule`, name, [
    hcl.attr('security_group_id', securityGroupId(role)),
    hcl.attr('description', hcl.string(description)),
    'role' in peer
      ? hcl.attr('referenced_security_group_id', securityGroupId(peer.role))
      : hcl.attr('cidr_ipv4', hcl.string(peer.cidr)),
    hcl.attr('ip_protocol', hcl.string('tcp')),
    hcl.attr('from_port', hcl.number(port)),
    hcl.attr('to_port', hcl.number(port)),
  ]);
}

function securityGroupNodes(input: GeneratorInput): HclNode[] {
  const roles = (Object.keys(ROLE_TEXT) as NetworkRole[]).filter((role) =>
    input.blocks.some((block) => ROLE_OF[block.type] === role),
  );
  const pairs = connectedPairs(input);
  const talks = (a: NetworkRole, b: NetworkRole) =>
    roles.includes(a) && roles.includes(b) && pairs.has(`${a}-${b}`);
  const engines = <T extends string>(type: BlockType, ports: Record<T, number>) =>
    (Object.keys(ports) as T[])
      .filter((engine) =>
        input.blocks.some((b) => b.type === type && b.attributes.engine === engine),
      )
      .map((engine) => [engine, ports[engine]] as const);

  const nodes = roles.map((role) =>
    resource('aws_security_group', role, [
      hcl.attr('description', hcl.string(ROLE_TEXT[role])),
      hcl.attr('vpc_id', VPC_ID),
    ]),
  );
  if (roles.includes('alb')) {
    // As duas únicas regras de entrada abertas à internet do arquivo; a 80 só redireciona para a 443.
    nodes.push(
      rule('ingress', 'alb_https', 'alb', 443, { cidr: ANY_IPV4 }, 'HTTPS da internet'),
      rule('ingress', 'alb_http', 'alb', 80, { cidr: ANY_IPV4 }, 'HTTP, só para redirecionar'),
    );
  }
  if (talks('alb', 'app')) {
    nodes.push(
      rule('egress', 'alb_to_app', 'alb', APP_PORT, { role: 'app' }, 'ALB para a aplicação'),
      rule('ingress', 'app_from_alb', 'app', APP_PORT, { role: 'alb' }, 'Só o ALB entra'),
    );
  }
  if (roles.includes('app')) {
    // Saída da aplicação: HTTPS (APIs da AWS e atualizações) e os bancos e caches ligados a ela.
    nodes.push(rule('egress', 'app_https', 'app', 443, { cidr: ANY_IPV4 }, 'HTTPS de saída'));
  }
  const stores = [
    ['db', engines('aws.rds', DB_PORTS)],
    ['cache', engines('aws.elasticache', CACHE_PORTS)],
  ] as const;
  for (const [role, ports] of stores) {
    if (!talks('app', role)) continue;
    for (const [engine, port] of ports) {
      nodes.push(
        rule(
          'ingress',
          `${role}_${engine}_from_app`,
          role,
          port,
          { role: 'app' },
          'Só a aplicação',
        ),
        rule('egress', `app_to_${role}_${engine}`, 'app', port, { role }, 'Aplicação para o dado'),
      );
    }
  }
  return nodes;
}

function networkNodes(input: GeneratorInput): HclNode[] {
  return [
    hcl.comment(`Rede compartilhada, gerada uma vez por design: VPC ${VPC_CIDR}, uma sub-rede`),
    hcl.comment(
      'pública e uma privada por zona usada (no mínimo duas) e um security group por papel.',
    ),
    hcl.comment('Sem bloco de NAT Gateway, as sub-redes privadas não têm saída para a internet.'),
    resource('aws_vpc', 'main', [
      hcl.attr('cidr_block', hcl.string(VPC_CIDR)),
      hcl.attr('enable_dns_support', hcl.bool(true)),
      hcl.attr('enable_dns_hostnames', hcl.bool(true)),
    ]),
    hcl.comment('O security group padrão da VPC fica sem nenhuma regra.'),
    resource('aws_default_security_group', 'main', [hcl.attr('vpc_id', VPC_ID)]),
    resource('aws_internet_gateway', 'main', [hcl.attr('vpc_id', VPC_ID)]),
    resource('aws_route_table', 'public', [hcl.attr('vpc_id', VPC_ID)]),
    resource('aws_route', 'public_internet', [
      hcl.attr('route_table_id', hcl.ref('aws_route_table', 'public', 'id')),
      hcl.attr('destination_cidr_block', hcl.string(ANY_IPV4)),
      hcl.attr('gateway_id', hcl.ref('aws_internet_gateway', 'main', 'id')),
    ]),
    ...designAzs(input.blocks).flatMap(subnetNodes),
    ...securityGroupNodes(input),
  ];
}

/** Junta a rede aos nós do bloco quando ele é o primeiro, na ordem do id, que precisa dela. */
export function withNetwork(input: GeneratorInput, nodes: readonly HclNode[]): GeneratorOutput {
  const owner = input.blocks.find((block) => NETWORK_OWNERS.includes(block.type));
  const network = owner?.id === input.block.id ? networkNodes(input) : [];
  return { exported: true, nodes: [...network, ...nodes] };
}
