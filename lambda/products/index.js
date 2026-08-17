// Funcao de exemplo (GET/POST /products) usada para validar o AWS DevOps
// Agent e o AWS Security Agent em laboratorio.
//
// Correcoes aplicadas ao longo do projeto:
// - TableName (nao Table) no ScanCommand (Cenario 3 do laboratorio manual)
// - console.error explicito para exceptions capturaveis (nao cobre timeouts)
// - Validacao de input + ConditionExpression (Finding #2, AWS Security
//   Agent, Code Review real): a versao anterior aceitava qualquer POST sem
//   autenticacao nem validacao, com id controlado pelo chamador e
//   PutCommand sem ConditionExpression, permitindo sobrescrita de
//   qualquer registro existente. Corrigido junto com a adicao de
//   HttpIamAuthorizer na rota (lib/ecommerce-app-stack.ts).

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;

const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 256;

function validateInput(body) {
  const errors = [];

  if (body.id !== undefined) {
    if (typeof body.id !== "string" || body.id.length === 0 || body.id.length > MAX_ID_LENGTH) {
      errors.push(`id deve ser uma string de 1 a ${MAX_ID_LENGTH} caracteres`);
    }
  }

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.length === 0 || body.name.length > MAX_NAME_LENGTH) {
      errors.push(`name deve ser uma string de 1 a ${MAX_NAME_LENGTH} caracteres`);
    }
  }

  if (body.price !== undefined) {
    if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price < 0) {
      errors.push("price deve ser um numero nao-negativo");
    }
  }

  return errors;
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath;

  // Verificacao de dominio do AWS Security Agent (HTTP_ROUTE). Precisa
  // responder ANTES de qualquer outra logica, sem depender de TABLE ou
  // autenticacao - essa rota e deliberadamente publica.
  if (path === "/.well-known/aws/securityagent-domain-verification.json") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens: [process.env.DOMAIN_VERIFICATION_TOKEN] }),
    };
  }

  try {
    if (method === "GET") {
      const data = await ddb.send(new ScanCommand({ TableName: TABLE }));
      return {
        statusCode: 200,
        body: JSON.stringify(data.Items ?? []),
      };
    }

    if (method === "POST") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return { statusCode: 400, body: JSON.stringify({ error: "JSON invalido" }) };
      }

      const validationErrors = validateInput(body);
      if (validationErrors.length > 0) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Validacao falhou", details: validationErrors }),
        };
      }

      const item = {
        id: body.id || Date.now().toString(),
        name: body.name || "produto-teste",
        price: body.price ?? 0,
      };

      try {
        await ddb.send(
          new PutCommand({
            TableName: TABLE,
            Item: item,
            ConditionExpression: "attribute_not_exists(id)",
          })
        );
      } catch (err) {
        if (err.name === "ConditionalCheckFailedException") {
          return {
            statusCode: 409,
            body: JSON.stringify({ error: `Produto com id ${item.id} ja existe` }),
          };
        }
        throw err;
      }

      return {
        statusCode: 201,
        body: JSON.stringify(item),
      };
    }

    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    console.error("Erro ao processar requisicao:", {
      method,
      tableName: TABLE,
      errorName: err.name,
      errorMessage: err.message,
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
