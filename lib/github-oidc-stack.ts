import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';

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
          // O GitHub adiciona IDs numericos imutaveis apos o nome da org e
          // do repo no sub claim (ex.: "repo:org@123/repo@456:..."), como
          // protecao contra reuso de identidade em caso de renomeacao.
          // Descoberto empiricamente via CloudTrail apos falha real de
          // AssumeRoleWithWebIdentity - nao documentado nos guias oficiais
          // consultados no momento da criacao deste projeto.
          'token.actions.githubusercontent.com:sub': `repo:${props.githubOrg}@*/${props.githubRepo}@*:*`,
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Padroes de ARN usados para restringir o escopo da policy abaixo.
    // Baseados na convencao de nomenclatura deste projeto: stacks e a
    // maioria dos recursos nomeados explicitamente usam o prefixo
    // "Ecommerce" ou "DevOpsAgentRole-"; o bucket/parametro de bootstrap do
    // CDK seguem a convencao fixa "cdk-hnb659fds-*".
    const stackArnPattern = `arn:aws:cloudformation:${this.region}:${this.account}:stack/Ecommerce*/*`;
    const iamRoleArnPattern = `arn:aws:iam::${this.account}:role/*`;
    const lambdaArnPattern = `arn:aws:lambda:${this.region}:${this.account}:function:EcommerceProductsFunction-*`;
    const dynamoDbArnPattern = `arn:aws:dynamodb:${this.region}:${this.account}:table/EcommerceProducts-*`;
    const cdkAssetsBucketPattern = `arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}*`;
    const cdkBootstrapParamPattern = `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`;

    // Nota: iam:role/* permanece amplo de proposito. As roles criadas por
    // este projeto nao seguem um prefixo unico previsivel (algumas usam
    // nome explicito "DevOpsAgentRole-*", outras sao geradas pelo CDK com
    // nome derivado do stack). Restringir isso com seguranca exigiria
    // nomear explicitamente TODAS as roles do projeto - ver Well-Architected
    // Review, item de prioridade media "CMK/roteiro de remediacao".
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkDeployCloudFormationAndCompute',
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:*',
          'lambda:*',
        ],
        resources: [stackArnPattern, lambdaArnPattern],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkDeployDynamoDb',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:*'],
        resources: [dynamoDbArnPattern],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkDeployIam',
        effect: iam.Effect.ALLOW,
        actions: [
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
        ],
        resources: [iamRoleArnPattern],
      })
    );

    // AWS DevOps Agent e API Gateway nao expoem um padrao de ARN previsivel
    // antes da criacao do recurso (IDs gerados dinamicamente) - permanecem
    // amplos por necessidade tecnica, nao por falta de revisao.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkDeployDevOpsAgentAndApiGateway',
        effect: iam.Effect.ALLOW,
        actions: ['devops-agent:*', 'aidevops:*', 'apigateway:*'],
        resources: ['*'],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkBootstrapAssets',
        effect: iam.Effect.ALLOW,
        actions: ['s3:*'],
        resources: [cdkAssetsBucketPattern],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkBootstrapParameters',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [cdkBootstrapParamPattern],
      })
    );

    new cdk.CfnOutput(this, 'GithubActionsRoleArn', {
      value: this.deployRole.roleArn,
      description:
        'Copie este ARN para o secret AWS_DEPLOY_ROLE_ARN no repositorio GitHub (Settings > Secrets and variables > Actions)',
    });

    // AwsSolutions-IAM5: os wildcards remanescentes nesta policy, apos o
    // escopamento por prefixo de ARN aplicado na Revisao Well-Architected,
    // sao necessidade tecnica documentada, nao descuido:
    // - cloudformation:*, lambda:*, dynamodb:* (Action) precisam ser amplos
    //   porque o CDK gerencia varias sub-operacoes do mesmo servico em
    //   conjunto durante um unico deploy (create/update/delete/tag/etc).
    // - Os padroes Resource::*Ecommerce* e *EcommerceProducts-* refletem a
    //   convencao de nomenclatura deste projeto, ja restringindo o escopo
    //   a recursos deste projeto especifico.
    // - aidevops:*, apigateway:*, devops-agent:* com Resource::* permanecem
    //   amplos porque esses servicos nao expoem um padrao de ARN previsivel
    //   antes da criacao do recurso (IDs gerados dinamicamente).
    // - s3:*/ssm:GetParameter* sao restritos ao bucket/parametro padrao de
    //   bootstrap do proprio CDK (convencao fixa "cdk-hnb659fds-*").
    NagSuppressions.addResourceSuppressions(
      this.deployRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Policy do pipeline de deploy CDK, escopada por prefixo de ARN onde tecnicamente possivel. Wildcards remanescentes documentados individualmente no codigo-fonte (ver comentario acima desta supressao).',
          appliesTo: [
            'Action::cloudformation:*',
            'Action::lambda:*',
            `Resource::arn:aws:cloudformation:${this.region}:${this.account}:stack/Ecommerce*/*`,
            `Resource::arn:aws:lambda:${this.region}:${this.account}:function:EcommerceProductsFunction-*`,
            'Action::dynamodb:*',
            `Resource::arn:aws:dynamodb:${this.region}:${this.account}:table/EcommerceProducts-*`,
            `Resource::arn:aws:iam::${this.account}:role/*`,
            'Action::aidevops:*',
            'Action::apigateway:*',
            'Action::devops-agent:*',
            'Resource::*',
            'Action::s3:*',
            `Resource::arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}*`,
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`,
          ],
        },
      ],
      true
    );
  }
}
