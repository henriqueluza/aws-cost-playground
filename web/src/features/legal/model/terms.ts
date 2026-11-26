import { MARKERS as M, type LegalDocument } from './document';

/** Rascunho para revisão do autor (Issue #79). Cada afirmação sai do ADR-0001 ou do PRD. */
export const termsOfUse: LegalDocument = {
  title: 'Termos de uso',
  lead: 'As regras para usar o AWS Cost Playground, o que ele promete e o que não promete.',
  sections: [
    {
      id: 'servico',
      heading: 'O que é o serviço',
      blocks: [
        {
          kind: 'p',
          text: `O AWS Cost Playground permite montar uma arquitetura na AWS num canvas, descrever a carga em linguagem natural e ver uma estimativa de custo mensal. Responsável: ${M.controller} (${M.contact}). Estes termos valem a partir de ${M.effective}. Ao usar o serviço, você concorda com eles.`,
        },
      ],
    },
    {
      id: 'estimativa',
      heading: 'Os valores são estimativas',
      blocks: [
        {
          kind: 'p',
          text: 'Os valores mostrados são uma estimativa, não uma cotação oficial. Eles vêm de um catálogo de preços da AWS, com a data indicada na tela, e de números de uso que podem ser estimados por inteligência artificial, preenchidos por padrão ou alterados por você.',
        },
        {
          kind: 'ul',
          items: [
            'O cálculo considera preço sob demanda. Não inclui Savings Plans, instâncias reservadas, Spot nem descontos de contrato.',
            'O preço real depende do seu uso, da sua conta e da data. A fatura da AWS é a única fonte oficial de cobrança.',
            'Para uma cotação oficial, use a AWS Pricing Calculator.',
            'A estimativa não substitui o seu planejamento financeiro, e você decide por sua conta o que fazer com ela.',
          ],
        },
      ],
    },
    {
      id: 'afiliacao',
      heading: 'Sem relação com a AWS e a Anthropic',
      blocks: [
        {
          kind: 'p',
          text: 'O serviço não é afiliado, patrocinado nem endossado pela Amazon Web Services nem pela Anthropic. Os nomes dos serviços e das empresas pertencem aos seus titulares e são usados só para identificar o que é estimado.',
        },
      ],
    },
    {
      id: 'conta',
      heading: 'Conta',
      blocks: [
        {
          kind: 'p',
          text: 'Usar o editor e o cálculo não exige conta. Salvar designs e pedir a estimativa de carga exigem cadastro com e-mail verificado. Você é responsável por manter sua senha em segredo e por tudo o que acontece na sua conta. Você pode excluir a conta a qualquer momento na página Conta, e isso apaga os seus designs e dados (veja a política de privacidade).',
        },
      ],
    },
    {
      id: 'descricao-de-carga',
      heading: 'Descrição de carga e inteligência artificial',
      blocks: [
        {
          kind: 'p',
          text: 'A descrição de carga é enviada à Anthropic para gerar os números de uso. Não inclua dado pessoal nela nem nos rótulos dos blocos.',
        },
        {
          kind: 'p',
          text: 'O modelo pode errar. Cada valor mostra a origem (estimado pela IA, padrão ou alterado por você), e o que você alterar à mão prevalece sobre a IA. Revise os números antes de confiar neles.',
        },
      ],
    },
    {
      id: 'uso-aceitavel',
      heading: 'Uso aceitável e limites',
      blocks: [
        {
          kind: 'p',
          text: 'Use o serviço de boa-fé. Não tente burlar os limites, sobrecarregar a API, acessar designs de outras pessoas, nem enviar conteúdo ilegal ou que prejudique terceiros. Podemos limitar ou suspender contas que façam isso.',
        },
        {
          kind: 'p',
          text: 'Os limites atuais são 20 estimativas por dia por conta e 300 por dia no total, até 50 designs por conta, 100 blocos por design e 2.000 caracteres na descrição de carga. Eles podem mudar. Quando o limite acaba, a tela informa e o contador volta no dia seguinte.',
        },
      ],
    },
    {
      id: 'seus-designs',
      heading: 'Seus designs',
      blocks: [
        {
          kind: 'p',
          text: 'Os designs são seus. Você nos autoriza apenas a guardá-los e a processá-los para prestar o serviço, como descrito na política de privacidade. Você é responsável por manter uma cópia: baixe o arquivo JSON dos designs importantes.',
        },
      ],
    },
    {
      id: 'terraform',
      heading: 'Código Terraform exportado',
      blocks: [
        {
          kind: 'p',
          text: 'O Terraform gerado é um ponto de partida. Leia e teste o código antes de aplicá-lo: você responde pelos recursos que criar na sua conta AWS e pelos custos deles.',
        },
      ],
    },
    {
      id: 'garantia',
      heading: 'Sem garantia e limite de responsabilidade',
      blocks: [
        {
          kind: 'p',
          text: 'O serviço é oferecido como está, sem garantia de disponibilidade, de ausência de erros nem de que as estimativas se confirmem. Podemos alterar, suspender ou encerrar o serviço.',
        },
        {
          kind: 'p',
          text: 'Na medida permitida pela lei, não respondemos por perdas ou custos decorrentes do uso das estimativas, do código exportado ou da indisponibilidade do serviço. Isso não afasta direitos que a lei garante e que não podem ser limitados.',
        },
      ],
    },
    {
      id: 'alteracoes',
      heading: 'Mudanças nestes termos',
      blocks: [
        {
          kind: 'p',
          text: 'Se os termos mudarem, a nova versão aparece aqui com a data de vigência atualizada. Continuar usando o serviço depois disso significa que você aceita a nova versão.',
        },
      ],
    },
    {
      id: 'lei-e-foro',
      heading: 'Lei aplicável e contato',
      blocks: [
        {
          kind: 'p',
          text: `Valem as leis do Brasil. Foro: ${M.forum}. Dúvidas e pedidos: ${M.contact}.`,
        },
      ],
    },
  ],
};
