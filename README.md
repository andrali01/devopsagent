# devops-agent-platform

Infraestrutura como código (AWS CDK / TypeScript) para provisionar o **AWS DevOps Agent** e uma aplicação de exemplo, de forma repetível e auditável — substituindo o processo manual documentado no laboratório da trilha de especialização (Módulo 9) por um pipeline profissional.

> **Contexto:** este projeto reaproveita a AWS Organization e as duas contas-membro (`EcommerceProd`, `EcommerceNonProd`) já provisionadas manualmente no laboratório. Não cria contas novas nem estrutura de Organization — ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) para o desenho completo.

## O que este projeto provisiona

Por ambiente (`prod` ou `nonprod`), três stacks CDK:

| Stack | Recursos |
|---|---|
| `Ecommerce{Env}-IamAgentRoles` | `DevOpsAgentRole-AgentSpace` e `DevOpsAgentRole-WebappAdmin` |
| `Ecommerce{Env}-App` | API Gateway (HTTP API) + Lambda + DynamoDB (aplicação de exemplo) |
| `Ecommerce{Env}-AgentSpace` | Agent Space + Operator App + associação da conta |

Mais um stack de bootstrap, deployado manualmente uma única vez por conta:

| Stack | Recursos |
|---|---|
| `Ecommerce{Env}-GithubOidc` | OIDC provider + IAM role para o GitHub Actions autenticar sem chaves estáticas |

## Pré-requisitos

- Node.js 20 ou superior
- AWS CLI configurado com um profile por ambiente (`ecommerce-prod`, `ecommerce-nonprod`)
- Conta AWS já pertencente à Organization, com as SCPs liberando `aidevops:*` e `bedrock:InvokeModel` (ver checklist no [`docs/RUNBOOK.md`](docs/RUNBOOK.md))
- CDK bootstrapado na conta de destino (ver abaixo)

## Setup local (primeira vez)

```powershell
npm install

# Bootstrap do CDK na conta de destino (uma vez por conta/região)
npx cdk bootstrap aws://467167898638/us-east-1 --profile ecommerce-prod
```

## Deploy manual (local)

```powershell
# Ver o que vai mudar, sem aplicar
npx cdk diff -c env=prod --profile ecommerce-prod

# Aplicar
npx cdk deploy --all -c env=prod --profile ecommerce-prod
```

Para o ambiente `nonprod`, troque `env=prod` por `env=nonprod` e o profile correspondente.

## Deploy via CI/CD (GitHub Actions)

### Passo 1 — Bootstrap do OIDC (manual, uma vez por conta)

```powershell
npx cdk deploy Ecommerce{Env}-GithubOidc `
  -c env=prod `
  -c deployOidc=true `
  -c githubOrg=<sua-org-github> `
  -c githubRepo=<seu-repositorio> `
  --profile ecommerce-prod
```

Copie o `GithubActionsRoleArn` do output.

### Passo 2 — Configurar o repositório GitHub

1. Em **Settings > Secrets and variables > Actions**, crie o secret `AWS_DEPLOY_ROLE_ARN` com o ARN copiado acima.
2. Em **Settings > Environments**, crie os ambientes `prod` e `nonprod`. Para `prod`, recomenda-se configurar **required reviewers** — especialmente para o workflow de destroy.

### Passo 3 — Deploy automático

- Push na branch `main` que altere `lib/`, `bin/` ou `lambda/` dispara o deploy automaticamente para `prod`.
- Para deploy manual de qualquer ambiente, use **Actions > Deploy DevOps Agent Platform > Run workflow**.

### Destruição (sempre manual)

**Actions > Destroy DevOps Agent Platform (manual) > Run workflow** — exige digitar `DESTROY` no campo de confirmação. Nunca roda automaticamente.

## Validação pós-deploy

```powershell
# Confirmar que o Agent Space foi criado
aws devops-agent get-agent-space --agent-space-id <ID_DO_OUTPUT> --region us-east-1 --profile ecommerce-prod

# Testar a API de exemplo
$apiUrl = "<ApiEndpoint_DO_OUTPUT>"
Invoke-RestMethod -Uri "$apiUrl/products" -Method Post -Body '{"name":"Notebook","price":3500}' -ContentType "application/json"
Invoke-RestMethod -Uri "$apiUrl/products" -Method Get
```

## Documentação adicional

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — desenho de arquitetura e decisões de design
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — operação do dia a dia, troubleshooting, checklist de pré-requisitos

## Referências

- [Getting started with AWS DevOps Agent using AWS CDK](https://docs.aws.amazon.com/devopsagent/latest/userguide/getting-started-with-aws-devops-agent-getting-started-with-aws-devops-agent-using-aws-cdk.html) (guia oficial)
- [aws-samples/sample-aws-devops-agent-cdk](https://github.com/aws-samples/sample-aws-devops-agent-cdk) (repositório de referência da AWS)
- Trilha de especialização AWS DevOps Agent (Act Digital) — Módulos 5, 6 e 9
