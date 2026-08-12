// Funcao de exemplo (GET/POST /products) usada para validar o AWS DevOps
// Agent em laboratorio. Corrige o bug encontrado e documentado no Cenario 3
// do laboratorio manual (TableName, nao Table, no ScanCommand) e adiciona
// console.error explicito - a ausencia de log de erro foi identificada como
// limitacao real na investigacao do agente (ver Apendice D do material).

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;

  try {
    if (method === "GET") {
      const data = await ddb.send(new ScanCommand({ TableName: TABLE }));
      return {
        statusCode: 200,
        body: JSON.stringify(data.Items ?? []),
      };
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const item = {
        id: body.id || Date.now().toString(),
        name: body.name || "produto-teste",
        price: body.price ?? 0,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return {
        statusCode: 201,
        body: JSON.stringify(item),
      };
    }

    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    // Log explicito no CloudWatch — essencial para que investigacoes do
    // AWS DevOps Agent (ou qualquer engenheiro humano) tenham evidencia
    // direta da causa, sem depender só do corpo da resposta HTTP.
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
