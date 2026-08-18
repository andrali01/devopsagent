#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { getEnvConfig, capitalize } from '../lib/config';
import { IamAgentRolesStack } from '../lib/iam-agent-roles-stack';
import { AgentSpaceStack } from '../lib/agent-space-stack';
import { EcommerceAppStack } from '../lib/ecommerce-app-stack';
import { GithubOidcStack } from '../lib/github-oidc-stack';
import { SecurityAgentRoleStack } from '../lib/security-agent-role-stack';
import { SecurityAgentSpaceStack } from '../lib/security-agent-space-stack';

const app = new cdk.App();

// Ambiente de destino: passe via `-c env=prod` ou `-c env=nonprod`.
// Default: prod, para manter compatibilidade com `cdk deploy --all` sem
// argumentos extras durante avaliacao inicial.
const envName = app.node.tryGetContext('env') ?? 'prod';
const config = getEnvConfig(envName);

const env: cdk.Environment = { account: config.account, region: config.region };
const prefix = `Ecommerce${capitalize(config.envName)}`;

// --- Stack de bootstrap (deploy manual, uma vez, ANTES do pipeline existir) ---
// So e sintetizada quando explicitamente solicitada via contexto, para nao
// ser recriada/atualizada sem querer em todo `cdk deploy --all` do dia a dia.
// Uso: cdk deploy EcommerceProd-GithubOidc -c env=prod -c deployOidc=true
//        -c githubOrg=<sua-org> -c githubRepo=<seu-repo> --profile ecommerce-prod
if (app.node.tryGetContext('deployOidc') === 'true') {
  new GithubOidcStack(app, `${prefix}-GithubOidc`, {
    env,
    githubOrg: app.node.tryGetContext('githubOrg') ?? 'CHANGE_ME_ORG',
    githubRepo: app.node.tryGetContext('githubRepo') ?? 'CHANGE_ME_REPO',
    description: 'Bootstrap de OIDC do GitHub Actions - deploy manual, uma vez por conta',
  });
}

// --- Stacks do dia a dia, deployados pelo pipeline (ou manualmente) ---
const iamStack = new IamAgentRolesStack(app, `${prefix}-IamAgentRoles`, {
  env,
  config,
  description: `IAM roles do AWS DevOps Agent - ambiente ${config.envName}`,
});

const appStack = new EcommerceAppStack(app, `${prefix}-App`, {
  env,
  config,
  description: `Aplicacao de exemplo (API + Lambda + DynamoDB) - ambiente ${config.envName}`,
});

const agentSpaceStack = new AgentSpaceStack(app, `${prefix}-AgentSpace`, {
  env,
  config,
  agentSpaceRole: iamStack.agentSpaceRole,
  webappAdminRole: iamStack.webappAdminRole,
  description: `Agent Space do AWS DevOps Agent - ambiente ${config.envName}`,
});
agentSpaceStack.addStackDependency(iamStack);

// Dependencia de ordem, nao de dados: por clareza, o Agent Space so e criado
// depois que a app de exemplo existe, ainda que nao haja referencia direta
// entre os dois stacks. Isso reflete a mesma ordem do laboratorio manual
// (Passos 24-27 antes do Passo 19) e evita corridas de criacao desnecessarias.
agentSpaceStack.addStackDependency(appStack);

// --- AWS Security Agent (novo) ---
// Segue a mesma logica de dependencia: a role precisa existir antes do
// Application, que precisa existir antes do AgentSpace (que referencia a
// Lambda da EcommerceAppStack para dar contexto de code review).
const securityRoleStack = new SecurityAgentRoleStack(app, `${prefix}-SecurityAgentRole`, {
  env,
  config,
  description: `IAM role do AWS Security Agent - ambiente ${config.envName}`,
});

const securitySpaceStack = new SecurityAgentSpaceStack(app, `${prefix}-SecurityAgentSpace`, {
  env,
  config,
  serviceRole: securityRoleStack.serviceRole,
  description: `Application + AgentSpace do AWS Security Agent - ambiente ${config.envName}`,
});
securitySpaceStack.addStackDependency(securityRoleStack);
securitySpaceStack.addStackDependency(appStack);

// cdk-nag: aplica verificacoes automatizadas de seguranca (AWS Solutions
// rules) contra os templates sintetizados de TODOS os stacks acima, antes
// de qualquer deploy. Retomado apos pausa - ver docs/RUNBOOK.md (secao
// sobre a causa raiz do bug de stage que interrompeu a primeira tentativa).
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
