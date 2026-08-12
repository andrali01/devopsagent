import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_devopsagent as devopsagent } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EnvConfig } from './config';

export interface AgentSpaceStackProps extends cdk.StackProps {
  config: EnvConfig;
  agentSpaceRole: iam.Role;
  webappAdminRole: iam.Role;
}

/**
 * Cria o Agent Space do AWS DevOps Agent via o recurso L1
 * AWS::DevOpsAgent::AgentSpace, com o Operator App configurado inline
 * (elimina o passo manual `enable-operator-app` via CLI que usamos no
 * laboratorio) e a associacao da conta primaria (accountType: monitor).
 *
 * Baseado no guia oficial "Getting started with AWS DevOps Agent using AWS
 * CDK" e no repositorio aws-samples/sample-aws-devops-agent-cdk.
 */
export class AgentSpaceStack extends cdk.Stack {
  public readonly agentSpaceId: string;
  public readonly agentSpaceArn: string;
  public readonly operatorAppUrl: string;

  constructor(scope: Construct, id: string, props: AgentSpaceStackProps) {
    super(scope, id, props);

    const { config, agentSpaceRole, webappAdminRole } = props;

    const agentSpace = new devopsagent.CfnAgentSpace(this, 'AgentSpace', {
      name: config.agentSpaceName,
      description: `Agent Space - ambiente ${config.envName} do e-commerce (Act Digital)`,
      operatorApp: {
        iam: {
          operatorAppRoleArn: webappAdminRole.roleArn,
        },
      },
    });

    // A associacao depende do Agent Space existir primeiro.
    const association = new devopsagent.CfnAssociation(this, 'AccountAssociation', {
      agentSpaceId: agentSpace.ref,
      serviceId: 'aws',
      configuration: {
        aws: {
          assumableRoleArn: agentSpaceRole.roleArn,
          accountId: this.account,
          accountType: 'monitor',
        },
      },
    });
    association.addResourceDependency(agentSpace);

    this.agentSpaceId = agentSpace.ref;
    this.agentSpaceArn = this.formatArn({
      service: 'aidevops',
      resource: 'agentspace',
      resourceName: agentSpace.ref,
    });
    this.operatorAppUrl = `https://${agentSpace.ref}.aidevops.global.app.aws`;

    new cdk.CfnOutput(this, 'AgentSpaceId', {
      value: this.agentSpaceId,
      description: 'ID do Agent Space criado',
    });
    new cdk.CfnOutput(this, 'AgentSpaceArn', {
      value: this.agentSpaceArn,
      description: 'ARN do Agent Space, usado para configurar contas secundarias',
    });
    new cdk.CfnOutput(this, 'OperatorAppUrl', {
      value: this.operatorAppUrl,
      description: 'URL do portal web do Agent Space',
    });

    cdk.Tags.of(this).add('project', 'devops-agent-platform');
    cdk.Tags.of(this).add('environment', config.envName);
  }
}
