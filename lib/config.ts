/**
 * Configuracao de ambientes do projeto.
 *
 * Reaproveita a AWS Organization e as contas ja provisionadas no laboratorio
 * manual (Modulo 9 da trilha de especializacao AWS DevOps Agent). Nao cria
 * contas novas - assume que "EcommerceProd" e "EcommerceNonProd" ja existem
 * e que o profile AWS CLI correspondente ja esta configurado localmente
 * (ou que a role de deploy do GitHub Actions tem acesso via OIDC).
 */

export interface EnvConfig {
  /** Nome curto do ambiente, usado em nomes de stack e recursos. */
  envName: 'prod' | 'nonprod';
  /** Account ID da conta AWS de destino. */
  account: string;
  /** Regiao AWS de deploy. Deve ser uma regiao suportada pelo AWS DevOps Agent. */
  region: string;
  /** Nome do Agent Space a ser criado/gerenciado neste ambiente. */
  agentSpaceName: string;
  /** Profile AWS CLI local sugerido para deploy manual (nao usado em CI/CD). */
  localProfile: string;
}

export const environments: Record<string, EnvConfig> = {
  prod: {
    envName: 'prod',
    account: '467167898638',
    region: 'us-east-1',
    agentSpaceName: 'EcommerceProd',
    localProfile: 'ecommerce-prod',
  },
  nonprod: {
    envName: 'nonprod',
    account: '425178887998',
    region: 'us-east-1',
    agentSpaceName: 'EcommerceNonProd',
    localProfile: 'ecommerce-nonprod',
  },
};

export function getEnvConfig(envName: string): EnvConfig {
  const config = environments[envName];
  if (!config) {
    throw new Error(
      `Ambiente "${envName}" desconhecido. Opcoes validas: ${Object.keys(environments).join(', ')}. ` +
        `Passe o ambiente via contexto CDK: cdk deploy --all -c env=prod`
    );
  }
  return config;
}

/** Capitaliza a primeira letra do nome do ambiente, para uso em nomes de stack (ex.: "Prod", "Nonprod"). */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
