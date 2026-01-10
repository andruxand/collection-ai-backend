import fs from "node:fs";
import path from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME;
if (!TABLE_NAME) {
  console.error("Missing TABLE_NAME env var (DynamoDB table name).");
  process.exit(1);
}

const dir = process.argv[2] || "configs/whatsapp-mappings";
const abs = path.resolve(process.cwd(), dir);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

async function putMapping(mapping) {
  const phoneNumberId = String(mapping.phoneNumberId || "");
  const tenantId = String(mapping.tenantId || "");
  if (!phoneNumberId || !tenantId) {
    throw new Error("Invalid mapping. Expected { phoneNumberId, tenantId }");
  }

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `WA_PHONE#${phoneNumberId}`,
        sk: "TENANT",
        tenantId
      }
    })
  );
}

const files = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith(".json")) : [];
if (!files.length) {
  console.error(`No mapping files found in ${abs}`);
  process.exit(1);
}

(async () => {
  for (const f of files) {
    const raw = fs.readFileSync(path.join(abs, f), "utf8");
    const json = JSON.parse(raw);
    const items = asArray(json);
    for (const it of items) {
      await putMapping(it);
      console.log("Seeded mapping", it.phoneNumberId, "->", it.tenantId);
    }
  }
  console.log("Done.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
