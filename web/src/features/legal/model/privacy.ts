import { MARKERS as M, type LegalDocument } from './document';

/** Rascunho para revisão do autor (Issue #79). Cada afirmação sai do ADR-0001 ou do PRD. */
export const privacyPolicy: LegalDocument = {
  title: 'Política de privacidade',
  lead: 'Quais dados o AWS Cost Playground trata, para quê, onde ficam e como você pode apagá-los.',
  sections: [
    {
      id: 'controlador',
      heading: 'Quem é o responsável',
      blocks: [
        {
          kind: 'p',
          text: `O controlador dos dados é ${M.controller}. Contato para qualquer assunto de privacidade: ${M.contact}. Encarregado pelo tratamento de dados pessoais: ${M.dpo}.`,
        },
        {
          kind: 'p',
          text: `Esta política vale a partir de ${M.effective}. O AWS Cost Playground é um serviço independente e não é afiliado à Amazon Web Services.`,
        },
      ],
    },
    {
      id: 'dados',
      heading: 'Quais dados tratamos',
      blocks: [
        {
          kind: 'p',
          text: 'O único dado pessoal que o serviço pede é o seu e-mail. Sem login, nada do que você monta sai do seu navegador.',
        },
        {
          kind: 'dl',
          items: [
            {
              term: 'E-mail e senha',
              text: 'Guardados pelo Amazon Cognito, que faz o cadastro, a verificação do e-mail, o login e a recuperação de senha. A aplicação do AWS Cost Playground não guarda a sua senha.',
            },
            {
              term: 'Designs salvos',
              text: 'Os desenhos que você salva estando logado: blocos, conexões, região, descrição de carga e valores de uso. Ficam ligados ao identificador interno da sua conta, e cada pessoa acessa só os seus.',
            },
            {
              term: 'Descrição de carga',
              text: 'O texto que você escreve para pedir a estimativa de uso. Ele é enviado à Claude API, da Anthropic, junto com o diagrama (os blocos, seus rótulos e as conexões). O seu e-mail não faz parte do que é enviado.',
            },
            {
              term: 'Contadores de uso',
              text: 'Quantas estimativas você pediu no dia, para aplicar o limite diário. Ficam ligados ao identificador interno da sua conta.',
            },
            {
              term: 'Registros técnicos',
              text: 'Registros de erro e de funcionamento da API, sem e-mail, sem cabeçalhos e sem o conteúdo dos pedidos.',
            },
          ],
        },
      ],
    },
    {
      id: 'aviso-descricao',
      heading: 'Não coloque dado pessoal na descrição de carga',
      blocks: [
        {
          kind: 'p',
          text: 'A descrição de carga e os rótulos dos blocos vão para um terceiro, a Anthropic. Descreva só a arquitetura e o volume esperado (por exemplo, "100 mil requisições por dia"). Não escreva nomes, e-mails, documentos, telefones, endereços nem dados de clientes ou de colegas.',
        },
      ],
    },
    {
      id: 'finalidades',
      heading: 'Para que usamos e em que base legal',
      blocks: [
        {
          kind: 'p',
          text: 'Cada uso se apoia numa base legal da Lei Geral de Proteção de Dados (Lei 13.709/2018, art. 7º).',
        },
        {
          kind: 'ul',
          items: [
            'Criar e manter a sua conta, e salvar e abrir os seus designs: execução do contrato de uso do serviço (art. 7º, V).',
            'Gerar a estimativa de uso a partir da sua descrição de carga: execução do contrato de uso do serviço (art. 7º, V), a seu pedido, ao clicar em "Re-estimar carga".',
            'Aplicar o limite diário de estimativas e manter registros técnicos: legítimo interesse em manter o serviço seguro e em evitar abuso e custo descontrolado (art. 7º, IX), com o mínimo de dados.',
          ],
        },
        {
          kind: 'p',
          text: 'Não usamos os dados para publicidade, perfilamento nem venda.',
        },
      ],
    },
    {
      id: 'terceiros',
      heading: 'Com quem os dados são compartilhados',
      blocks: [
        {
          kind: 'p',
          text: 'Usamos dois operadores, que tratam os dados só para prestar o serviço:',
        },
        {
          kind: 'dl',
          items: [
            {
              term: 'Amazon Web Services (AWS)',
              text: 'Hospeda o site e a API e guarda os dados: Amazon Cognito (e-mail e senha), DynamoDB (designs e contadores), CloudFront e S3 (o site), Lambda e API Gateway (a API) e CloudWatch (registros técnicos).',
            },
            {
              term: 'Anthropic',
              text: 'Recebe a descrição de carga e o diagrama para devolver números de uso, pela Claude API. Só números validados voltam para a tela.',
            },
          ],
        },
        {
          kind: 'p',
          text: `O tratamento pela Anthropic segue as regras e a política de retenção dela: ${M.anthropicRetention}.`,
        },
      ],
    },
    {
      id: 'transferencia',
      heading: 'Onde os dados ficam e transferência internacional',
      blocks: [
        {
          kind: 'p',
          text: `A infraestrutura fica na região us-east-1 da AWS (Norte da Virgínia, Estados Unidos), fora do Brasil. A Anthropic também trata dados fora do Brasil (${M.anthropicLocation}). Por isso há transferência internacional de dados, feita para prestar o serviço que você usa (LGPD, art. 33).`,
        },
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies e armazenamento no navegador',
      blocks: [
        {
          kind: 'p',
          text: 'Não usamos cookies de marketing, de análise de uso (analytics) nem de rastreamento de terceiros, e por isso não há banner de consentimento. As fontes do site são servidas por nós, sem pedir arquivos a terceiros.',
        },
        {
          kind: 'p',
          text: 'Guardamos no navegador só o que o funcionamento exige: a sua escolha de tema (claro ou escuro) e, depois do login, a sessão. O login é feito na página gerenciada do Amazon Cognito, que pode usar cookies próprios para manter essa sessão.',
        },
      ],
    },
    {
      id: 'retencao',
      heading: 'Por quanto tempo guardamos',
      blocks: [
        {
          kind: 'ul',
          items: [
            'E-mail e senha: até você excluir a conta.',
            'Designs salvos: até você apagá-los ou excluir a conta.',
            'Contadores de uso: 35 dias e depois são removidos automaticamente.',
            'Registros técnicos: 7 dias.',
            `Cópias de segurança do banco de dados: em produção ele mantém recuperação a um ponto no tempo, então restos de um dado apagado podem existir nessas cópias por um tempo limitado (${M.pitr}).`,
          ],
        },
      ],
    },
    {
      id: 'direitos',
      heading: 'Seus direitos e como exercê-los',
      blocks: [
        {
          kind: 'p',
          text: 'Pela LGPD (art. 18) você pode pedir confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação do que for desnecessário, portabilidade, informação sobre com quem compartilhamos, e a revogação de consentimento quando ele for a base do tratamento.',
        },
        {
          kind: 'ul',
          items: [
            'Excluir a sua conta: use a opção de exclusão na página Conta. Ela apaga os seus designs, os contadores e o seu usuário no Cognito.',
            'Levar os seus designs: cada design pode ser baixado como arquivo JSON.',
            `Qualquer outro pedido: escreva para ${M.contact}. Respondemos em até 15 dias.`,
          ],
        },
        {
          kind: 'p',
          text: 'Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).',
        },
      ],
    },
    {
      id: 'seguranca',
      heading: 'Como protegemos os dados',
      blocks: [
        {
          kind: 'ul',
          items: [
            'A conexão com o site e com a API usa HTTPS.',
            'A API identifica você só pelo seu login, e cada pessoa acessa apenas os próprios designs.',
            'Os registros técnicos não levam e-mail, cabeçalhos nem o conteúdo dos pedidos.',
            'A chave de acesso à Claude API fica guardada no servidor e nunca chega ao navegador.',
          ],
        },
      ],
    },
    {
      id: 'alteracoes',
      heading: 'Mudanças nesta política',
      blocks: [
        {
          kind: 'p',
          text: 'Se a política mudar, a nova versão aparece aqui com a data de vigência atualizada.',
        },
      ],
    },
  ],
};
