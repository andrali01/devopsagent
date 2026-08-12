# Arquitetura

## Visão geral

```
                          AWS Organization (existente, fora deste projeto)
                                          │
                    ┌─────────────────────┴─────────────────────┐
                    │                                             │
          Conta EcommerceProd                           Conta EcommerceNonProd
          (467167898638)                                (425178887998)
                    │                                             │
      ┌─────────────┴─────────────┐                 (mesma estrutura,
      │                            │                  stack "nonprod")
┌─────▼──────┐            ┌────────▼────────┐
│ IamAgentRoles│           │      App        │
│              │           │                 │
│ AgentSpace   │           │ API Gateway     │
│ Role         │           │      │          │
│              │           │      ▼          │
│ WebappAdmin  │           │  Lambda         │
│ Role         │           │      │          │
└─────┬────────┘           │      ▼          │
      │                    │  DynamoDB       │
      │                    └────────┬────────┘
      │                             │
      └──────────────┬──────────────┘
                      │
              ┌───────▼────────┐
              │   AgentSpace    │
              │                 │
              │ Agent Space +   │
              │ Operator App +  │
              │ Association     │
              └─────────────────┘
```

## Por que três stacks, e não um só

Separar `IamAgentRoles`, `App` e `AgentSpace` em stacks distintos, em vez de um único stack monolítico, segue um princípio de blast radius aplicado a deploys (o mesmo princípio de isolamento discutido no Módulo 2 da trilha, agora aplicado à unidade de mudança):

- **`IamAgentRoles`** muda raramente — só quando políticas de acesso do agente mudam. Isolá-lo evita que uma alteração de rotina na aplicação force reavaliação de permissões IAM.
- **`App`** muda com frequência — é onde o time de desenvolvimento mexe no dia a dia. Um erro aqui não deveria arriscar o Agent Space.
- **`AgentSpace`** depende dos dois anteriores, mas raramente muda por si só depois de criado.

Essa separação também permite que, no futuro, `App` seja substituído por um pipeline de deploy próprio da aplicação real do cliente, sem tocar nos outros dois stacks.

## Por que o stack de OIDC é separado e manual

O `GithubOidcStack` cria um recurso singleton por conta (o OIDC provider só pode existir uma vez por URL de emissor). Incluí-lo no fluxo automático de `cdk deploy --all` criaria dois problemas:

1. **Problema do ovo e da galinha**: o pipeline de CI/CD precisa da role criada por esse stack para se autenticar — ele não pode deployar o próprio pré-requisito de sua autenticação.
2. **Risco de duplicação**: se a conta já tiver um provider OIDC do GitHub Actions criado por outro projeto, uma segunda tentativa de criação falha.

Por isso, esse stack só é sintetizado com a flag explícita `-c deployOidc=true`, e o README documenta isso como etapa manual de bootstrap.

## Decisões de configuração da aplicação de exemplo

| Decisão | Valor | Motivo |
|---|---|---|
| DynamoDB billing mode | `PAY_PER_REQUEST` | Padrão correto por default; o laboratório manual usou `PROVISIONED` (1 RCU/1 WCU) deliberadamente para forçar um cenário de teste — não é uma configuração a ser replicada em código real |
| Lambda timeout | 10s | Valor que se mostrou adequado no laboratório (Cenário 1 testou exatamente essa fronteira) |
| Lambda runtime | Node.js 24.x | Node.js 20.x está em fim de suporte (criação desabilitada a partir de fev/2027) |
| `removalPolicy` da tabela | `DESTROY` | Adequado para laboratório/dev; **trocar para `RETAIN` antes de qualquer uso com dados reais** |
| Log de erro explícito na Lambda | `console.error(...)` no catch | Corrige uma lacuna identificada no Cenário 3 do laboratório: a ausência de log de erro explícito dificultou a correlação de causa raiz pelo próprio AWS DevOps Agent |

## Fronteira de responsabilidade deste projeto

Este projeto **não** provisiona:

- A AWS Organization em si, nem as contas-membro (assume que já existem)
- SCPs de guardrail (devem ser validadas manualmente antes do primeiro deploy — ver Runbook)
- Integrações externas do Agent Space (GitHub, Slack, Datadog etc.) — ficam para um stack de integrações separado, fora do escopo inicial
- Private connections via VPC Lattice (Módulo 4.6 da trilha) — relevante apenas quando houver serviços privados a conectar
