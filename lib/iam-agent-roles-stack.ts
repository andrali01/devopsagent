import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EnvConfig } from './config';

export interface IamAgentRolesStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/**
 * Cria as duas IAM roles exigidas pelo AWS DevOps Agent, replicando
 * exatamente o que foi feito manualmente no laboratorio (Modulo 9, Passos
 * 14-18 da trilha de especializacao), agora como codigo declarativo.
 *
 * - DevOpsAgentRole-AgentSpace: assumida pelo SERVICO aidevops.amazonaws.com
 *   para investigar recursos (read-only). Managed policy AIDevOpsAgentAccessPolicy
 *   + policy inline para permitir a criacao da service-linked role do
 *   Resource Explorer (necessaria para descoberta de topologia).
 *
 * - DevOpsAgentRole-WebappAdmin: assumida pelo mesmo servico para dar acesso
 *   de operador humano ao portal web do Agent Space. Requer sts:TagSession
 *   alem de sts:AssumeRole (achado do laboratorio - a policy do operador usa
 *   a tag de sessao AgentSpaceId para escopar acesso).
 */
export class IamAgentRolesStack extends cdk.Stack {
  public readonly agentSpaceRole: iam.Role;
  public readonly webappAdminRole: iam.Role;

  constructor(scope: Construct, id: string, props: IamAgentRolesStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Padrao de ARN de Agent Space usado nas condicoes de trust policy.
    // O agent space ainda nao existe neste ponto do deploy (e criado no
    // proximo stack) - por isso usamos um wildcard escopado a conta, e nao
    // um ARN especifico. Isso e o mesmo padrao usado no repositorio oficial
    // de amostra da AWS (aws-samples/sample-aws-devops-agent-cdk).
    const agentSpaceArnPattern = `arn:aws:aidevops:${this.region}:${this.account}:agentspace/*`;

    // --- Role do agente (read-only, usada para investigacoes) ---
    this.agentSpaceRole = new iam.Role(this, 'AgentSpaceRole', {
      roleName: 'DevOpsAgentRole-AgentSpace',
      description:
        'Assumida pelo servico AWS DevOps Agent para descobrir e investigar recursos nesta conta (somente leitura).',
      assumedBy: new iam.ServicePrincipal('aidevops.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': agentSpaceArnPattern },
        },
      }),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AIDevOpsAgentAccessPolicy'),
      ],
    });

    // Permissao adicional exigida para o agente criar a service-linked role
    // do Resource Explorer na primeira descoberta de topologia. Sem isso, a
    // topologia falha silenciosamente (ver Modulo 9 / Apendice D.3 da trilha).
    this.agentSpaceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AllowCreateServiceLinkedRoles',
        effect: iam.Effect.ALLOW,
        actions: ['iam:CreateServiceLinkedRole'],
        resources: [
          `arn:aws:iam::${this.account}:role/aws-service-role/resource-explorer-2.amazonaws.com/AWSServiceRoleForResourceExplorer`,
        ],
      })
    );

    // --- Role de operador (acesso humano ao portal web) ---
    this.webappAdminRole = new iam.Role(this, 'WebappAdminRole', {
      roleName: 'DevOpsAgentRole-WebappAdmin',
      description:
        'Assumida pelo servico AWS DevOps Agent para conceder acesso de operador humano ao portal web do Agent Space.',
      // .withSessionTags() adiciona sts:TagSession a trust policy, alem do
      // sts:AssumeRole padrao. Isso e necessario porque a managed policy do
      // operador usa a condicao aws:PrincipalTag/AgentSpaceId para restringir
      // o acesso a um Agent Space especifico - descoberto empiricamente no
      // laboratorio (Passo 18.1) antes de confirmarmos isso na documentacao.
      assumedBy: new iam.ServicePrincipal('aidevops.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': agentSpaceArnPattern },
        },
      }).withSessionTags(),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AIDevOpsOperatorAppAccessPolicy'),
      ],
    });

    new cdk.CfnOutput(this, 'AgentSpaceRoleArn', {
      value: this.agentSpaceRole.roleArn,
      description: 'ARN da role assumida pelo agente para investigacoes',
    });
    new cdk.CfnOutput(this, 'WebappAdminRoleArn', {
      value: this.webappAdminRole.roleArn,
      description: 'ARN da role de operador do portal web',
    });

    cdk.Tags.of(this).add('project', 'devops-agent-platform');
    cdk.Tags.of(this).add('environment', config.envName);
  }
}
