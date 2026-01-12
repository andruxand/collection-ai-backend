import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const require = createRequire(import.meta.url);
const { getTableName } = require("./config.js");

const TABLE_NAME = getTableName();

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
