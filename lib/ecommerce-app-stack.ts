import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpIamAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { NagSuppressions } from 'cdk-nag';
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
      // Corrigido apos Revisao Well-Architected (Confiabilidade, item critico):
      // RETAIN preserva a tabela mesmo apos `cdk destroy` - evita perda de
      // dados acidental. Point-in-time recovery permite restaurar para
      // qualquer momento dos ultimos 35 dias.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
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
        // Token de verificacao de dominio do AWS Security Agent (Fase 2 -
        // Penetration Testing). Obtido no console: Security Agent > Target
        // Domains > yq4na76w9g.execute-api.us-east-1.amazonaws.com.
        // Servido publicamente (sem authorizer) na rota dedicada abaixo,
        // conforme exigido pelo metodo de verificacao HTTP_ROUTE.
        DOMAIN_VERIFICATION_TOKEN: 'sPaDlkFZRnz9gY1XApik2w',
      },
      description: 'API de produtos (GET/POST) - app de teste para o AWS DevOps Agent',
    });

    table.grantReadWriteData(fn);

    // NOTA: access logging via CfnStage explicito foi tentado durante o
    // trabalho de cdk-nag, mas esse deploy especifico nunca chegou a ser
    // aplicado (sessao foi interrompida). O stage $default REAL na AWS
    // ainda tem o logical-id gerado automaticamente pelo modo
    // createDefaultStage: true. Revertido para essa forma simples para
    // nao colidir com o recurso real existente (erro "already exists" ao
    // tentar trocar o logical-id do stage). Reintroduzir access logging
    // fica como item de trabalho futuro, exigindo substituicao controlada
    // do stage (ver docs/RUNBOOK.md).
    const httpApi = new apigwv2.HttpApi(this, 'ProductsApi', {
      apiName: `EcommerceProductsApi-${config.envName}`,
      description: 'HTTP API de produtos - app de teste para o AWS DevOps Agent',
    });

    // Correcao do Finding #2 (AWS Security Agent, Code Review real):
    // rota estava totalmente publica, sem authorizer, permitindo qualquer
    // chamador anonimo da internet escrever/sobrescrever dados. IAM
    // Authorizer exige que o chamador assine a requisicao com SigV4 e
    // tenha permissao IAM explicita (execute-api:Invoke) - consistente com
    // o padrao IAM-first ja usado no resto deste projeto.
    const iamAuthorizer = new HttpIamAuthorizer();

    httpApi.addRoutes({
      path: '/products',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ProductsIntegration', fn),
      authorizer: iamAuthorizer,
    });

    // Rota de verificacao de dominio para o AWS Security Agent (Fase 2 -
    // Penetration Testing, metodo HTTP_ROUTE). DELIBERADAMENTE PUBLICA
    // (sem authorizer) - o servico da AWS precisa conseguir fazer um GET
    // anonimo aqui para confirmar posse do dominio, antes de qualquer
    // pentest ser autorizado. So devolve um token estatico, sem acesso a
    // dados reais - superficie de risco minima e aceitavel.
    const verificationRoutes = httpApi.addRoutes({
      path: '/.well-known/aws/securityagent-domain-verification.json',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('DomainVerificationIntegration', fn),
    });

    this.apiUrl = httpApi.apiEndpoint;
    this.tableName = table.tableName;
    this.functionName = fn.functionName;

    // AwsSolutions-APIG1: access logging revertido nesta rodada porque a
    // troca para CfnStage explicito colidiria com o stage $default REAL ja
    // implantado (logical-id auto-gerado, ver nota acima). Suprimido
    // temporariamente ate uma migracao controlada do stage ser feita -
    // nao e ausencia permanente de intencao, e divida tecnica registrada.
    NagSuppressions.addResourceSuppressions(
      httpApi,
      [
        {
          id: 'AwsSolutions-APIG1',
          reason:
            'Access logging temporariamente suprimido - migrar para CfnStage explicito exigiria substituir o stage $default real (colisao de logical-id). Ver docs/RUNBOOK.md para o plano de migracao controlada.',
        },
      ],
      true // applyToChildren: a regra APIG1 e avaliada no Stage implicito (filho do HttpApi), nao no HttpApi em si.
    );

    // AwsSolutions-APIG4 (rota de verificacao de dominio): suprimida
    // pontualmente, so para esta rota especifica - NAO para /products
    // (que ja tem HttpIamAuthorizer). Deliberadamente publica por exigencia
    // do metodo de verificacao HTTP_ROUTE do AWS Security Agent (ver
    // comentario acima da rota). So devolve um token estatico.
    NagSuppressions.addResourceSuppressions(verificationRoutes, [
      {
        id: 'AwsSolutions-APIG4',
        reason:
          'Rota de verificacao de dominio HTTP_ROUTE do AWS Security Agent - deliberadamente publica, exigencia do proprio metodo de verificacao. So devolve um token estatico, sem acesso a dados.',
      },
    ]);

    // AwsSolutions-APIG4: suppressao removida - Finding #2 do AWS Security
    // Agent (Code Review real) corrigido com HttpIamAuthorizer (ver acima).
    // A rota nao e mais publica sem autenticacao.

    // AwsSolutions-IAM4: AWSLambdaBasicExecutionRole e a managed policy
    // padrao da industria para permissao minima de logging de Lambda -
    // substitui-la por policy customizada equivalente nao traria ganho real
    // de seguranca.
    NagSuppressions.addResourceSuppressions(
      fn.role!,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'AWSLambdaBasicExecutionRole e a managed policy padrao da AWS para permissao de escrita em CloudWatch Logs - pratica recomendada, nao um gap de seguranca.',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
      ],
      true
    );

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.apiUrl,
      description: 'URL base da API de produtos',
    });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'FunctionName', { value: fn.functionName });

    cdk.Tags.of(this).add('project', 'devops-agent-platform');
    cdk.Tags.of(this).add('environment', config.envName);
  }
}
