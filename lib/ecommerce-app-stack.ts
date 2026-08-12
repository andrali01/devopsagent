import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as path from 'path';
import { EnvConfig } from './config';

export interface EcommerceAppStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/**
 * Aplicacao de exemplo usada para gerar telemetria real para o AWS DevOps
 * Agent investigar. Arquitetura: API Gateway (HTTP API) -> Lambda -> DynamoDB.
 *
 * Diferencas deliberadas em relacao ao laboratorio manual:
 * - DynamoDB em PAY_PER_REQUEST (nao PROVISIONED 1/1) - essa configuracao
 *   minima so fazia sentido para forcar throttling em teste; em qualquer
 *   ambiente real, on-demand e a escolha correta por padrao.
 * - Codigo da Lambda como asset versionado (lambda/products/index.js), nao
 *   inline no template - mais facil de revisar, testar e versionar.
 * - RemovalPolicy.DESTROY na tabela é adequado para lab/dev. Trocar para
 *   RETAIN (ou RETAIN_ON_UPDATE_OR_DELETE) antes de usar em produção real
 *   com dados que importam.
 */
export class EcommerceAppStack extends cdk.Stack {
  public readonly apiUrl: string;
  public readonly tableName: string;
  public readonly functionName: string;

  constructor(scope: Construct, id: string, props: EcommerceAppStackProps) {
    super(scope, id, props);

    const { config } = props;

    const table = new dynamodb.Table(this, 'ProductsTable', {
      tableName: `EcommerceProducts-${config.envName}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // ATENCAO: DESTROY apaga a tabela (e os dados) ao rodar `cdk destroy`.
      // Adequado para laboratorio/dev. Mude para RETAIN em produção real.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fn = new lambda.Function(this, 'ProductsFunction', {
      functionName: `EcommerceProductsFunction-${config.envName}`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'products')),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        TABLE_NAME: table.tableName,
      },
      description: 'API de produtos (GET/POST) - app de teste para o AWS DevOps Agent',
    });

    table.grantReadWriteData(fn);

    const httpApi = new apigwv2.HttpApi(this, 'ProductsApi', {
      apiName: `EcommerceProductsApi-${config.envName}`,
      description: 'HTTP API de produtos - app de teste para o AWS DevOps Agent',
    });

    httpApi.addRoutes({
      path: '/products',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ProductsIntegration', fn),
    });

    this.apiUrl = httpApi.apiEndpoint;
    this.tableName = table.tableName;
    this.functionName = fn.functionName;

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: httpApi.apiEndpoint,
      description: 'URL base da API de produtos',
    });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'FunctionName', { value: fn.functionName });

    cdk.Tags.of(this).add('project', 'devops-agent-platform');
    cdk.Tags.of(this).add('environment', config.envName);
  }
}
