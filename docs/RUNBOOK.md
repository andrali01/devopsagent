# Runbook operacional

## Checklist de pré-requisitos (antes do primeiro deploy em uma conta nova)

Baseado em problemas reais encontrados no laboratório manual (Módulo 9 da trilha). Validar **antes** de rodar `cdk deploy` evita horas de troubleshooting depois.

- [ ] SCP da Organization permite `aidevops:*`
- [ ] SCP da Organization permite `bedrock:InvokeModel`
- [ ] SCP da Organization permite ações do VPC Lattice (só necessário se for usar private connections no futuro)
- [ ] CDK já foi bootstrapado na conta/região de destino (`cdk bootstrap aws://<conta>/<região>`)
- [ ] O profile AWS CLI local aponta para a conta correta (`aws sts get-caller-identity --profile <profile>`)

## Deploy — passo a passo

```powershell
npx cdk diff -c env=prod --profile ecommerce-prod
npx cdk deploy --all -c env=prod --profile ecommerce-prod
```

**Tempo esperado:** a criação do Agent Space costuma ser rápida (segundos). A stack `App` (Lambda + DynamoDB + API Gateway) também é rápida. Se o deploy do `AgentSpace` falhar imediatamente após a criação das roles IAM, é provável **propagação de IAM** (leva alguns minutos) — aguarde e rode `cdk deploy` de novo.

## Validação pós-deploy

### 1. Confirmar que o Agent Space existe

```powershell
aws devops-agent get-agent-space --agent-space-id <ID> --region us-east-1 --profile ecommerce-prod
```

### 2. Confirmar a aplicação de exemplo

```powershell
$apiUrl = "<ApiEndpoint do output>"
Invoke-RestMethod -Uri "$apiUrl/products" -Method Post -Body '{"name":"item-teste","price":10}' -ContentType "application/json"
Invoke-RestMethod -Uri "$apiUrl/products" -Method Get
```

### 3. Acessar o portal web

```powershell
# URL disponível no output OperatorAppUrl da stack AgentSpace
```

## Problemas conhecidos e como diagnosticar

### A Topologia aparece vazia mesmo com tudo certo

**Sintoma:** o Agent Space existe, a associação está `valid`, mas a aba Topologia do portal só mostra o nó da conta, sem recursos.

**Causa provável:** limitação documentada do estágio atual do produto (reproduzida em laboratório e relatada publicamente no AWS re:Post com o mesmo sintoma).

**Impacto real:** nenhum — o motor de investigação funciona normalmente via consultas diretas no chat, mesmo com a Topologia vazia. Não é bloqueador.

**Como confirmar que não é um problema seu:** pergunte algo específico no chat do portal, como *"Descreva minha função Lambda `EcommerceProductsFunction-prod`"*. Se a resposta vier com detalhes reais e corretos, a investigação está funcionando — o problema é só cosmético, na visualização de Topologia.

### `disable-operator-app` ou `enable-operator-app` retornam `ValidationException` sobre `auth-flow`

Esses comandos exigem `--auth-flow iam` (ou `idc`/`idp`, conforme o método de autenticação configurado). Isso não se aplica ao deploy via CDK deste projeto — o `operatorApp` já vem configurado declarativamente no `CfnAgentSpace`. Só é relevante se você for operar via CLI manualmente por algum motivo.

### `ResourceNotFoundException` ao chamar operações no Agent Space

Confirme primeiro que o Agent Space realmente existe:

```powershell
aws devops-agent list-agent-spaces --region us-east-1 --profile ecommerce-prod
```

No laboratório manual, observamos um caso em que o Agent Space deixou de existir sem uma exclusão explícita nossa — trate isso como um comportamento possível do serviço em estágio de preview/GA recente, não necessariamente um erro de configuração. Se a lista vier vazia, rode `cdk deploy` de novo para recriar.

### Investigações do agente citam causas raiz concorrentes, uma delas incorreta

**Padrão observado:** eventos `UpdateFunctionCode` no CloudTrail mostram `"environment": {}`, e o agente pode interpretar isso incorretamente como "variáveis de ambiente removidas" — mesmo quando elas nunca foram tocadas.

**Ação:** sempre confirme qualquer alegação sobre configuração citando `aws lambda get-function-configuration` antes de aceitar como causa raiz, especialmente antes de repassar a um cliente ou tomar ação de mitigação.

### Números específicos (latências, RCU/WCU, timeouts) no relatório da investigação parecem estranhos

**Ação obrigatória:** verifique cada número contra a métrica de origem (CloudWatch) antes de confiar. No laboratório, uma investigação apresentou diagnóstico geral correto com 4 de 5 números de suporte fabricados. Ver Apêndice D da trilha de especialização para o caso documentado completo.

## Destruição do ambiente

**Via CI/CD (recomendado):** workflow `destroy.yml`, disparo manual, exige digitar `DESTROY`.

**Local:**

```powershell
npx cdk destroy --all -c env=prod --profile ecommerce-prod
```

**Ordem de destruição:** o CDK respeita automaticamente as dependências declaradas (`AgentSpace` depende de `IamAgentRoles` e `App`) e destrói na ordem inversa correta sozinho — diferente do processo manual do laboratório, onde a ordem tinha que ser controlada manualmente (Agent Space → stack CloudFormation → IAM roles).

**Atenção:** com `removalPolicy: DESTROY` na tabela DynamoDB (configuração atual, adequada para lab/dev), os dados da tabela são apagados permanentemente junto com o destroy. Confirme que isso é aceitável antes de rodar em qualquer ambiente com dados que importam.

## Adicionando uma segunda conta ao mesmo Agent Space (cross-account monitoring)

Este projeto, no escopo atual, cria um Agent Space por ambiente/conta (padrão "um Agent Space por fronteira de on-call", Módulo 2 da trilha). Para monitoramento cross-account a partir de um único Agent Space, ver o guia oficial da AWS ("Part 2" do guia de CDK) e adaptar o `ServiceStack` do repositório de referência `aws-samples/sample-aws-devops-agent-cdk` — não incluído neste projeto por estar fora do escopo definido.
