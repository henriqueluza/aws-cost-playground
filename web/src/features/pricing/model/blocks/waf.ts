import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/**
 * `aws.waf`: web ACLs e regras por mês (custo fixo) e requisições inspecionadas, emitidas mesmo
 * com uso zero. `rules` é o total de regras do bloco, não por web ACL. Requisições na faixa de
 * até 1.500 WCU com a inspeção de corpo padrão. Sem franquia; os preços ficam no catálogo, não
 * aqui.
 * Fora de escopo: WCU acima de 1.500, inspeção de corpo acima do padrão, WAF Classic, escopo do
 * CloudFront, Shield, Bot Control, Fraud Control, CAPTCHA e Challenge e regras do Marketplace.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceWaf: BlockPricer = ({ usage }) => {
  const { webAcls, rules, requestsPerMonth } = usage;
  if (webAcls === undefined || rules === undefined || requestsPerMonth === undefined) {
    throw new RangeError('aws.waf: uso fora do contrato');
  }
  return [
    { sku: 'waf-web-acls', quantity: decimal(webAcls), charge: 'fixed' },
    { sku: 'waf-rules', quantity: decimal(rules), charge: 'fixed' },
    { sku: 'waf-requests', quantity: decimal(requestsPerMonth), charge: 'variable' },
  ];
};
