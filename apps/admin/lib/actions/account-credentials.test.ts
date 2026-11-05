import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { hashPassword, tempPassword } from "@tokophi/lib/password";

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
  /** Runs once, right before the action's next UPDATE executes — where a racing request's write lands. */
  beforeUpdate: null as null | (() => Promise<void>),
}));

/** `db` whose next `update(...)` first runs `h.beforeUpdate` (drizzle builders are lazy until awaited). */
function racing(real: PostgresJsDatabase): PostgresJsDatabase {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== "update" || !h.beforeUpdate) return Reflect.get(target, prop, receiver);
      return (...args: Parameters<PostgresJsDatabase["update"]>) => {
        const builder = target.update(...args);
        const set = builder.set.bind(builder);
        const hook = h.beforeUpdate!;
        h.beforeUpdate = null;
        // `.set()` creates the executable query; `.where()`/`.returning()` return that same object.
        return Object.assign(builder, {
          set: (values: Parameters<typeof set>[0]) => {
            const query = set(values);
            const then = query.then.bind(query);
            return Object.assign(query, { then: (ok: never, err: never) => hook().then(() => then(ok, err)) });
          },
        });
      };
    },
  });
}

vi.mock("@tokophi/db", async () => ({
  get db() {
    return racing(h.db);
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
let enable2FA: typeof import("./security").enable2FA;
let disable2FA: typeof import("./security").disable2FA;
let password: string; // minted per user() — never a literal (packages/lib/src/password.test.ts)
const made: string[] = [];

async function user(opts: { withPassword?: boolean; totp?: boolean } = {}) {
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
  ({ setup2FA, enable2FA, disable2FA } = await import("./security"));
});
beforeEach(() => {
  h.imp = undefined;
  h.beforeUpdate = null;
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

// Review 2026-11-06 (GPT-6.1 Sol): the guard was a read-then-write. These inject the racing request's
// write between the action's check and its UPDATE — exactly where it lands in production.
suite("2FA enrollment — concurrent setup2FA / enable2FA", () => {
  it("setup2FA cannot switch off a 2FA that a concurrent enable2FA just activated", async () => {
    const u = await user();
    await client`update users set totp_secret = 'JBSWY3DPEHPK3PXP' where id = ${u.id}`;
    h.beforeUpdate = async () => {
      await client`update users set totp_enabled = true where id = ${u.id}`; // the enable landed first
    };
    const r = await setup2FA();
    expect(r.ok).toBe(false);
    expect(r.secret).toBeUndefined(); // no secret disclosed for a write that did not happen
    expect(await row(u.id)).toMatchObject({ totp_secret: "JBSWY3DPEHPK3PXP", totp_enabled: true });
  });

  it("enable2FA does not activate a secret that a concurrent setup2FA swapped in after the code was checked", async () => {
    const u = await user();
    const verified = "JBSWY3DPEHPK3PXP";
    await client`update users set totp_secret = ${verified} where id = ${u.id}`;
    const { totpAt } = await import("@tokophi/lib/totp");
    h.beforeUpdate = async () => {
      await client`update users set totp_secret = 'KRSXG5CTMVRXEZLU' where id = ${u.id}`; // re-enrolled
    };
    const r = await enable2FA(totpAt(verified, Date.now()));
    expect(r.ok).toBe(false);
    expect(await row(u.id)).toMatchObject({ totp_secret: "KRSXG5CTMVRXEZLU", totp_enabled: false });
  });

  it("enable2FA still activates when nothing raced it", async () => {
    const u = await user();
    const secret = "JBSWY3DPEHPK3PXP";
    await client`update users set totp_secret = ${secret} where id = ${u.id}`;
    const { totpAt } = await import("@tokophi/lib/totp");
    expect(await enable2FA(totpAt(secret, Date.now()))).toEqual({ ok: true });
    expect(await row(u.id)).toMatchObject({ totp_secret: secret, totp_enabled: true });
  });

  it("a stale no-code disable2FA cannot wipe a 2FA that setup+enable completed after its read", async () => {
    const u = await user(); // no secret, 2FA off: disable2FA("") skips the code check
    h.beforeUpdate = async () => {
      await client`update users set totp_secret = 'JBSWY3DPEHPK3PXP', totp_enabled = true where id = ${u.id}`;
    };
    const r = await disable2FA("");
    expect(r.ok).toBe(false);
    expect(await row(u.id)).toMatchObject({ totp_secret: "JBSWY3DPEHPK3PXP", totp_enabled: true });
  });

  it("disable2FA with the right code still switches 2FA off", async () => {
    const u = await user({ totp: true });
    const { totpAt } = await import("@tokophi/lib/totp");
    expect(await disable2FA(totpAt("JBSWY3DPEHPK3PXP", Date.now()))).toEqual({ ok: true });
    expect(await row(u.id)).toMatchObject({ totp_secret: null, totp_enabled: false });
  });
});
