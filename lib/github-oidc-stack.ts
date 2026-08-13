import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface GithubOidcStackProps extends cdk.StackProps {
  githubOrg: string;
  githubRepo: string;
}

export class GithubOidcStack extends cdk.Stack {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

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
          'token.actions.githubusercontent.com:sub': `repo:${props.githubOrg}@*/${props.githubRepo}@*:*`,
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    const stackArnPattern = `arn:aws:cloudformation:${this.region}:${this.account}:stack/Ecommerce*/*`;
    const iamRoleArnPattern = `arn:aws:iam::${this.account}:role/*`;
    const lambdaArnPattern = `arn:aws:lambda:${this.region}:${this.account}:function:EcommerceProductsFunction-*`;
    const dynamoDbArnPattern = `arn:aws:dynamodb:${this.region}:${this.account}:table/EcommerceProducts-*`;
    const cdkAssetsBucketPattern = `arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}*`;
    const cdkBootstrapParamPattern = `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`;

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkDeployCloudFormationAndCompute',
        effect: iam.Effect.ALLOW,
        actions: ['cloudformation:*', 'lambda:*'],
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
  }
}
