import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

/**
 * A SESSION ALONE MUST NOT REWRITE THE LOGIN CREDENTIALS (review 2026-10-29), against real Postgres.
 *
 *  - `updateProfile` changed `users.email` with a session and nothing else. The email is the login
 *    identity AND the key "Masuk dengan Google" links on, so a stolen cookie became a permanent way in.
 *    Now an email change needs the current password and is refused under impersonation; a name-only
 *    change needs neither.
 *  - `setup2FA` overwrote the secret of an ACTIVE 2FA and set `totp_enabled = false` — `disable2FA`'s
 *    code check, bypassed. Now it refuses while 2FA is on.
 *
 * Every case reads the ROW back: the claim is what the database holds, not what the action says.
 */

const h = vi.hoisted(() => ({
  db: null as unknown as PostgresJsDatabase,
  userId: "",
  imp: undefined as undefined | { operatorId: string },
}));

vi.mock("@tokophi/db", async () => ({
  get db() {
    return h.db;
  },
  schema: await import("@tokophi/db/schema"),
}));

// The real `verifyPassword` is kept — the claim is that the action checks the password it stores.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getSession: async () => ({
    userId: h.userId,
    storeId: randomUUID(),
    role: "owner",
    email: "x@example.test",
    name: "X",
    ...(h.imp ? { imp: h.imp } : {}),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {}, get: () => undefined, delete: () => {} }) }));

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const run = randomUUID().slice(0, 8);

let client: Sql;
let updateProfile: typeof import("./profile").updateProfile;
let setup2FA: typeof import("./security").setup2FA;
let password = "";
const made: string[] = [];

async function user(opts: { withPassword?: boolean; totp?: boolean } = {}) {
  const { hashPassword, tempPassword } = await import("@tokophi/lib/password");
  password = tempPassword();
  const email = `cred-${run}-${made.length}@example.test`;
  const [u] = await client<{ id: string }[]>`
    insert into users (email, name, password_hash, totp_secret, totp_enabled)
    values (${email}, 'Cred', ${opts.withPassword === false ? null : hashPassword(password)},
            ${opts.totp ? "JBSWY3DPEHPK3PXP" : null}, ${opts.totp ?? false})
    returning id`;
  made.push(u.id);
  h.userId = u.id;
  return { id: u.id, email };
}
const row = async (id: string) =>
  (await client<{ email: string; name: string; totp_secret: string | null; totp_enabled: boolean }[]>`
    select email, name, totp_secret, totp_enabled from users where id = ${id}`)[0];

beforeAll(async () => {
  if (!URL_) return;
  process.env.AUTH_SECRET ??= "test-secret-for-account-credentials-0123456789";
  client = postgres(URL_, { max: 2 });
  h.db = drizzle(client, { casing: "snake_case" });
  ({ updateProfile } = await import("./profile"));
  ({ setup2FA } = await import("./security"));
});
beforeEach(() => {
  h.imp = undefined;
});
afterAll(async () => {
  if (!client) return;
  try {
    for (const id of made) await client`delete from users where id = ${id}`;
  } finally {
    await client.end();
  }
});

suite("updateProfile — the login email needs the current password", () => {
  it("refuses an email change with no password, and the row keeps its email", async () => {
    const u = await user();
    const r = await updateProfile({ name: "Cred", email: `new-${run}-a@example.test` });
    expect(r.ok).toBe(false);
    expect((await row(u.id)).email).toBe(u.email);
  });

  it("refuses a wrong password", async () => {
    const u = await user();
    const r = await updateProfile({ name: "Cred", email: `new-${run}-b@example.test`, currentPassword: "not-the-password" });
    expect(r).toMatchObject({ ok: false, error: "Kata sandi saat ini salah." });
    expect((await row(u.id)).email).toBe(u.email);
  });

  it("accepts the right password", async () => {
    const u = await user();
    const to = `new-${run}-c@example.test`;
    expect(await updateProfile({ name: "Cred", email: to, currentPassword: password })).toEqual({ ok: true });
    expect((await row(u.id)).email).toBe(to);
  });

  it("a name-only change needs no password", async () => {
    const u = await user();
    expect(await updateProfile({ name: "Nama Baru", email: u.email })).toEqual({ ok: true });
    expect((await row(u.id)).name).toBe("Nama Baru");
  });

  it("is refused under impersonation even with the right password", async () => {
    const u = await user();
    h.imp = { operatorId: randomUUID() };
    const r = await updateProfile({ name: "Cred", email: `new-${run}-d@example.test`, currentPassword: password });
    expect(r.ok).toBe(false);
    expect((await row(u.id)).email).toBe(u.email);
  });

  it("a Google-only account (no password) cannot change it", async () => {
    const u = await user({ withPassword: false });
    const r = await updateProfile({ name: "Cred", email: `new-${run}-e@example.test`, currentPassword: "" });
    expect(r.ok).toBe(false);
    expect((await row(u.id)).email).toBe(u.email);
  });
});

suite("setup2FA — never switches an ACTIVE 2FA off", () => {
  it("refuses while 2FA is on; secret and flag are untouched", async () => {
    const u = await user({ totp: true });
    const r = await setup2FA();
    expect(r.ok).toBe(false);
    expect(await row(u.id)).toMatchObject({ totp_secret: "JBSWY3DPEHPK3PXP", totp_enabled: true });
  });

  it("still enrolls when 2FA is off", async () => {
    const u = await user();
    const r = await setup2FA();
    expect(r.ok).toBe(true);
    const after = await row(u.id);
    expect(after.totp_secret).toBe(r.secret);
    expect(after.totp_enabled).toBe(false);
  });
});
