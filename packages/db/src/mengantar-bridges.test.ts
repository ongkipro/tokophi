import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";
import { bridgeMengantarAreas } from "./mengantar-bridges";

// EVERY DEPLOY RE-SEEDS THE AREA TABLES — the Mengantar bridge must survive it (2026-11-12: the first
// production deploy after the area import left 0/7 030 kecamatan bridged; every Mengantar quote fell back).
// `seed-areas.ts` truncates `kiriminaja_areas` + `kelurahan` (where the bridge columns live) and reloads
// them from CSV; it must then rebuild the bridge from `mengantar_areas` with the loader's own rule.

describe("seed-areas rebuilds the Mengantar bridge after its truncate (source)", () => {
  // `codeOnly`: a commented-out call must not keep this green.
  const SRC = codeOnly(readFileSync(new URL("./seed-areas.ts", import.meta.url), "utf8"));
  it("calls bridgeMengantarAreas AFTER the truncate and the kelurahan reload", () => {
    // `codeOnly` makes literal contents inert, so the anchor is the CALL that runs the truncate SQL.
    const truncate = SRC.search(/client\s*\.\s*unsafe\s*\(/);
    const reload = SRC.search(/await\s+seedKelurahan\s*\(\s*\)/);
    const bridge = SRC.search(/bridgeMengantarAreas\s*\(\s*client\s*\)/);
    expect(truncate).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(truncate);
    expect(bridge).toBeGreaterThan(reload);
  });
});

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const run = randomUUID().slice(0, 6);
const hex = () => randomBytes(12).toString("hex");
const DISTRICT = 990_000 + Math.floor(Math.random() * 9_000);
const KEL_ID = `mgb-${run}`;
const AREA = hex();
let client: Sql;

suite("bridgeMengantarAreas — the same bridge after a wipe (real Postgres)", () => {
  beforeAll(async () => {
    client = postgres(URL_!, { max: 2, onnotice: () => {} });
    await client`insert into kiriminaja_areas (id, district_name, city_name, province_name) values (${DISTRICT}, ${`Pakisuji ${run}`}, ${`Kota Ujian ${run}`}, 'Jawa Timur')`;
    await client`insert into kelurahan (id, district_id, name, postcode) values (${KEL_ID}, ${DISTRICT}, ${`Sukamaju ${run}`}, '99901')`;
    await client`insert into mengantar_areas (id, province, city, district, subdistrict, postal_code, dataset_version)
                 values (${AREA}, 'JAWA TIMUR', ${`UJIAN ${run}`}, ${`PAKISUJI ${run}`}, ${`SUKAMAJU ${run}`}, '99901', 'test')`;
  });
  afterAll(async () => {
    if (!client) return;
    await client`delete from kelurahan where id = ${KEL_ID}`;
    await client`delete from kiriminaja_areas where id = ${DISTRICT}`;
    await client`delete from mengantar_areas where id = ${AREA}`;
    await client.end();
  });
  const bridges = async () => ({
    kel: (await client<{ m: string | null }[]>`select mengantar_area_id m from kelurahan where id = ${KEL_ID}`)[0].m,
    kec: (await client<{ m: string | null }[]>`select mengantar_area_id m from kiriminaja_areas where id = ${DISTRICT}`)[0].m,
  });

  it("bridges a unique match, and rebuilds it identically after the columns are wiped (what a deploy does)", async () => {
    await bridgeMengantarAreas(client);
    const first = await bridges();
    expect(first).toEqual({ kel: AREA, kec: AREA });
    await client`update kelurahan set mengantar_area_id = null where id = ${KEL_ID}`;
    await client`update kiriminaja_areas set mengantar_area_id = null where id = ${DISTRICT}`;
    await bridgeMengantarAreas(client);
    expect(await bridges()).toEqual(first);
  });

  it("is idempotent: a second run writes nothing for already-bridged rows", async () => {
    const c = await bridgeMengantarAreas(client);
    expect(c.kelByPostcode + c.kelByDistrict + c.kecFromKel + c.kecFromDistrict).toBe(0);
  });
});
