import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EnvConfig } from './config';

export interface SecurityAgentRoleStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/**
 * Cria a IAM role que o AWS Security Agent assume para interagir com
 * recursos AWS (leitura, para dar contexto ao code review e ao pentest).
 *
 * Baseado na documentacao oficial "Create an IAM Role for AWS Security
 * Agent": https://docs.aws.amazon.com/securityagent/latest/userguide/create-iam-role.html
 *
 * Nota: a documentacao oficial sugere opcionalmente um `sts:ExternalId` na
 * trust policy para reforco de seguranca em cenarios cross-account. Como
 * este e um cenario same-account (principal de servico
 * securityagent.amazonaws.com), seguimos o mesmo padrao ja validado com
 * sucesso no AWS DevOps Agent: escopo via aws:SourceAccount/SourceArn, sem
 * ExternalId. Se a AWS Security Agent exigir ExternalId em algum momento
 * do setup via console, essa trust policy precisara ser ajustada - isso
 * sera validado no primeiro teste real (ver docs/RUNBOOK.md).
 */
/**
 * Cria a IAM role que o AWS Security Agent assume para permitir que
 * usuarios do portal web interajam com a API do servico (criar/gerenciar
 * code reviews, pentests, ver findings).
 *
 * CORRECAO IMPORTANTE: a managed policy correta para esta role e
 * `AWSSecurityAgentWebAppPolicy` (confirmada em
 * docs.aws.amazon.com/securityagent/latest/userguide/security-iam-awsmanpol.html
 * e no repositorio oficial de exemplo aws-samples/sample-terraform-for-security-agent).
 * Uma primeira versao deste arquivo usava `SecurityAudit` por engano -
 * essa policy e para um proposito diferente (leitura de recursos AWS
 * durante pentest), nao para a role do Application.
 */
export class SecurityAgentRoleStack extends cdk.Stack {
  public readonly serviceRole: iam.Role;

  constructor(scope: Construct, id: string, props: SecurityAgentRoleStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.serviceRole = new iam.Role(this, 'SecurityAgentServiceRole', {
      roleName: 'SecurityAgentRole-Application',
      description:
        'Assumida pelo AWS Security Agent para permitir que usuarios do portal web interajam com a API do servico.',
      assumedBy: new iam.ServicePrincipal('securityagent.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSSecurityAgentWebAppPolicy'),
      ],
    });

    // Correcao do erro "logs:GetLogEvents ... no identity-based policy
    // allows" observado tanto na Code Review quanto no Pentest reais
    // (docs/RUNBOOK.md). A AWSSecurityAgentWebAppPolicy nao inclui
    // permissao para o portal ler de volta os proprios logs de execucao
    // do servico. Escopado ao log group do proprio Security Agent, sem
    // acesso a logs de outros servicos.
    this.serviceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AllowReadOwnExecutionLogs',
        effect: iam.Effect.ALLOW,
        actions: ['logs:GetLogEvents', 'logs:DescribeLogStreams', 'logs:DescribeLogGroups'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/securityagent/*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/securityagent/*:*`,
        ],
      })
    );

    new cdk.CfnOutput(this, 'SecurityAgentServiceRoleArn', {
      value: this.serviceRole.roleArn,
      description: 'ARN da role usada pelo Application do AWS Security Agent',
    });

    cdk.Tags.of(this).add('project', 'devops-agent-platform');
    cdk.Tags.of(this).add('environment', config.envName);
  }
}
