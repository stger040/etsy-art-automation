import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }

  const sql = readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

  await client.connect();
  console.log("Connected to Postgres. Applying db/schema.sql ...");
  try {
    await client.query(sql);
    console.log("Schema applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
