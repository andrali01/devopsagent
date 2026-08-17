import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_securityagent as securityagent } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EnvConfig } from './config';

export interface SecurityAgentSpaceStackProps extends cdk.StackProps {
  config: EnvConfig;
  serviceRole: iam.Role;
}

export class SecurityAgentSpaceStack extends cdk.Stack {
  public readonly applicationId: string;
  public readonly agentSpaceId: string;

  constructor(scope: Construct, id: string, props: SecurityAgentSpaceStackProps) {
    super(scope, id, props);

    const { config, serviceRole } = props;

    const application = new securityagent.CfnApplication(this, 'Application', {
      roleArn: serviceRole.roleArn,
    });

    const agentSpace = new securityagent.CfnAgentSpace(this, 'AgentSpace', {
      name: `${config.agentSpaceName}-Security`,
      description: `AWS Security Agent - code review e pentest do e-commerce (ambiente ${config.envName})`,
      codeReviewSettings: {
        controlsScanning: true,
        generalPurposeScanning: true,
      },
      awsResources: {
        lambdaFunctionArns: [
          `arn:aws:lambda:${this.region}:${this.account}:function:EcommerceProductsFunction-${config.envName}`,
        ],
      },
    });
    agentSpace.addResourceDependency(application);

    this.applicationId = application.attrApplicationId;
    this.agentSpaceId = agentSpace.ref;

    new cdk.CfnOutput(this, 'ApplicationId', {
      value: this.applicationId,
      description: 'ID do Application do AWS Security Agent (nivel de conta)',
    });
    new cdk.CfnOutput(this, 'ApplicationDomain', {
      value: application.attrDomain,
      description: 'Dominio do portal web do AWS Security Agent',
    });
    new cdk.CfnOutput(this, 'SecurityAgentSpaceId', {
      value: this.agentSpaceId,
      description: 'ID do Agent Space - use para conectar o GitHub manualmente no console',
    });

    cdk.Tags.of(this).add('project', 'devops-agent-platform');
    cdk.Tags.of(this).add('environment', config.envName);
  }
}
