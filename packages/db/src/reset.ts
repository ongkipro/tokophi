// Full local reset: drop schema (data) AND the drizzle migration journal, then recreate.
// Run: npm run reset -w @tokophi/db   (follow with `npm run migrate` + `npm run seed`)
import { client } from "./client";

async function main() {
  await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  console.log("Reset: dropped public + drizzle schemas, recreated public.");
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
