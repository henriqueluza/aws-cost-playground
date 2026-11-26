import { zeroCostPricer } from '../zeroCost';

/**
 * `aws.ecs`: custo zero no modo EC2, o único modelado. O ECS não cobra pelo cluster nem pelas
 * tarefas: o custo é das instâncias `aws.ec2` ligadas pela aresta `runs-on`
 * (`contracts/edges.json`). O atributo opcional `az` não muda o preço. Sem a aresta, o bloco
 * continua com zero e o resultado leva o aviso `missing-runs-on`. Fargate, que cobra por vCPU e
 * memória, não é modelado. Não tem SKU nem arquivo de preço.
 */
export const priceEcs = zeroCostPricer({ kind: 'billed-on-host', hostTypes: ['aws.ec2'] });
