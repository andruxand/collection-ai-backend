import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const require = createRequire(import.meta.url);
const { getTableName, getRegion } = require("./config.js");

const TABLE_NAME = getTableName();
const REGION = getRegion();

// Default to shared policy templates under configs/policy-templates.
// You can override via CLI arg: `node scripts/seed-country-policies.mjs path/to/dir`.
const dir = process.argv[2] || "configs/policy-templates";
const abs = path.resolve(process.cwd(), dir);

console.log(`Seeding country policies into table ${TABLE_NAME} in region ${REGION}`);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true }
});

const files = fs.readdirSync(abs).filter((f) => f.endsWith(".json"));
if (!files.length) {
  console.error(`No policy files found in ${abs}`);
  process.exit(1);
}

const COUNTRY_REGISTRY_PK = "COUNTRIES";

async function putPolicy(policy) {
  const cc = String(policy.countryCode || "").toUpperCase();
  if (!cc) throw new Error("countryCode missing in policy file");

  const nowIso = new Date().toISOString();

  // main item
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `COUNTRY#${cc}`,
      sk: "POLICY",
      entity: "COUNTRY_POLICY",
      countryCode: cc,
      version: String(policy.version || "v1"),
      updatedAtIso: String(policy.updatedAtIso || nowIso),
      policy
    }
  }));

  // registry
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: COUNTRY_REGISTRY_PK,
      sk: `COUNTRY#${cc}`,
      entity: "COUNTRY_REGISTRY",
      countryCode: cc,
      updatedAtIso: nowIso
    }
  }));

  console.log(`Seeded policy for ${cc}`);
}

for (const f of files) {
  const raw = fs.readFileSync(path.join(abs, f), "utf-8");
  const policy = JSON.parse(raw);
  await putPolicy(policy);
}

console.log("Done.");
