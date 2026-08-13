import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface GithubOidcStackProps extends cdk.StackProps {
  /** Organizacao ou usuario do GitHub (ex.: "act-digital"). */
  githubOrg: string;
  /** Nome do repositorio (ex.: "devops-agent-platform"). */
  githubRepo: string;
}

/**
 * Stack de BOOTSTRAP - deploy manual, uma unica vez por conta, ANTES de
 * configurar o pipeline de CI/CD.
 *
 * Cria o OIDC provider do GitHub Actions (se ainda nao existir na conta) e
 * uma IAM role que o workflow do GitHub assume via
 * `aws-actions/configure-aws-credentials`, sem nenhuma chave de acesso
 * estatica armazenada como secret do repositorio - GitHub Actions troca um
 * JWT assinado pelo próprio GitHub por credenciais temporarias via STS.
 *
 * IMPORTANTE: a policy anexada aqui e propositalmente ampla o suficiente
 * para operacoes de `cdk deploy`/`cdk destroy` deste projeto especifico.
 * Para producao real, restrinja os `resources` por ARN e remova acoes que
 * o pipeline nao usa - trate isto como ponto de partida, nao como policy
 * final (ver Modulo 6.4 do material: menor privilegio, revisao periodica).
 */
export class GithubOidcStack extends cdk.Stack {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    // Cria o provider apenas se ainda nao existir uma instancia na conta.
    // Uma conta AWS so pode ter UM OIDC provider por URL de emissor - se
    // voce ja tem um provider do GitHub Actions criado por outro projeto,
    // substitua este bloco por
    // iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(...).
    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    this.deployRole = new iam.Role(this, 'GithubActionsDeployRole', {
      roleName: 'GithubActions-DevOpsAgentPlatform-Deploy',
      description:
        'Assumida pelo GitHub Actions via OIDC para deploy/destroy do projeto devops-agent-platform.',
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          // Restringe a role a esse repositorio especifico. Ajuste o padrao
          // (ex.: ":ref:refs/heads/main") se quiser restringir tambem por
          // branch, o que é recomendado para o workflow de destroy.
          //'token.actions.githubusercontent.com:sub': `repo:${props.githubOrg}/${props.githubRepo}:*`,
          'token.actions.githubusercontent.com:sub': `repo:${props.githubOrg}@*/${props.githubRepo}@*:*`,
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkDeployPermissions',
        effect: iam.Effect.ALLOW,
        actions: [
          // CloudFormation - motor por tras do cdk deploy/destroy
          'cloudformation:*',
          // IAM - criacao das roles do DevOps Agent e da propria role de deploy
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:GetRole',
          'iam:GetRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PassRole',
          'iam:TagRole',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
          // Recursos da aplicacao de exemplo
          'lambda:*',
          'dynamodb:*',
          'apigateway:*',
          // AWS DevOps Agent
          'devops-agent:*',
          'aidevops:*',
          // Bucket de assets do CDK e parametros de bootstrap
          's3:*',
          'ssm:GetParameter',
          'ssm:GetParameters',
        ],
        resources: ['*'],
      })
    );

    new cdk.CfnOutput(this, 'GithubActionsRoleArn', {
      value: this.deployRole.roleArn,
      description:
        'Copie este ARN para o secret AWS_DEPLOY_ROLE_ARN no repositorio GitHub (Settings > Secrets and variables > Actions)',
    });
  }
}
