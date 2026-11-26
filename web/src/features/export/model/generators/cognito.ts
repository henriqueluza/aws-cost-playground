import type { BlockGenerator } from '../generator';
import { hcl } from '../hcl';
import { ordinalId } from './network';

const MIN_PASSWORD_LENGTH = 12;
const TEMPORARY_PASSWORD_DAYS = 7;

/**
 * Cognito: um pool de usuários com login por e-mail, política de senha, MFA por aplicativo
 * disponível e proteção contra exclusão, mais um cliente público. O cliente não tem segredo
 * (`generate_secret = false`) e só aceita SRP, em que a senha não trafega.
 */
export const cognito: BlockGenerator = (input) => {
  const { block } = input;
  const id = ordinalId(input, 'usuarios');
  const flag = (name: string) => hcl.attr(name, hcl.bool(true));
  return {
    exported: true,
    nodes: [
      hcl.comment(
        'O cadastro é aberto e o e-mail sai pelo envio padrão do Cognito, que tem limite',
      ),
      hcl.comment('diário. Sem SMS, que tem custo à parte. O cliente não tem segredo.'),
      hcl.block(
        'resource',
        ['aws_cognito_user_pool', block.name],
        [
          hcl.attr('name', hcl.string(id)),
          hcl.attr('user_pool_tier', hcl.string(String(block.attributes.tier).toUpperCase())),
          hcl.attr('username_attributes', hcl.list([hcl.string('email')])),
          hcl.attr('auto_verified_attributes', hcl.list([hcl.string('email')])),
          hcl.attr('mfa_configuration', hcl.string('OPTIONAL')),
          hcl.attr('deletion_protection', hcl.string('ACTIVE')),
          hcl.block(
            'password_policy',
            [],
            [
              hcl.attr('minimum_length', hcl.number(MIN_PASSWORD_LENGTH)),
              flag('require_lowercase'),
              flag('require_uppercase'),
              flag('require_numbers'),
              flag('require_symbols'),
              hcl.attr('temporary_password_validity_days', hcl.number(TEMPORARY_PASSWORD_DAYS)),
            ],
          ),
          hcl.block('software_token_mfa_configuration', [], [flag('enabled')]),
          hcl.block(
            'account_recovery_setting',
            [],
            [
              hcl.block(
                'recovery_mechanism',
                [],
                [
                  hcl.attr('name', hcl.string('verified_email')),
                  hcl.attr('priority', hcl.number(1)),
                ],
              ),
            ],
          ),
          // A proteção contra ameaças só existe no nível Plus.
          ...(block.attributes.tier === 'plus'
            ? [
                hcl.block(
                  'user_pool_add_ons',
                  [],
                  [hcl.attr('advanced_security_mode', hcl.string('ENFORCED'))],
                ),
              ]
            : []),
        ],
      ),
      hcl.block(
        'resource',
        ['aws_cognito_user_pool_client', block.name],
        [
          hcl.attr('name', hcl.string(`${id}-app`)),
          hcl.attr('user_pool_id', hcl.ref('aws_cognito_user_pool', block.name, 'id')),
          hcl.attr('generate_secret', hcl.bool(false)),
          hcl.attr(
            'explicit_auth_flows',
            hcl.list(['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'].map(hcl.string)),
          ),
          hcl.attr('prevent_user_existence_errors', hcl.string('ENABLED')),
          flag('enable_token_revocation'),
        ],
      ),
    ],
  };
};
