import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { waLink } from "@tokophi/lib/format";
import { getSession } from "@/lib/auth";
// Pure (no DB import) so it is testable without a DATABASE_URL — see the note in that file.
// Re-exported below because callers have always imported it from here.
import { cartMessage } from "@/lib/cart-message";
import { getStoreName, getStorefrontHost } from "@/lib/data/store";
import { recoveryUrl } from "@tokophi/lib/recovery";

// Abandoned checkouts (0044). Every figure on the Keranjang Ditinggal screen is a `count`/`sum` over
// `checkout_sessions` + `orders` — there is no modelled, blended or "estimated" number here, and if
// something cannot be counted (message delivered? read?) it is not shown at all.
//
// ⚠️ THE REAL CLOCK. This was `CHECKOUT_TODAY = 2026-07-02`, the seed's frame, and it broke both
// halves of the screen:
//   · every cart a real shopper abandoned was newer than the anchor, so `Math.max(0, …)` clamped it
//     to 0 and the whole list read "baru saja" — which collapses `score()` below, whose entire job
//     is to decay basket value by age. Every cart ranked as if it were a minute old.
//   · "30 hari terakhir" was not a window at all: the window START was a frozen 2026-06-02 with no
//     upper bound, so the range it actually covered grew by a day every day (60 days by 1 Agustus)
//     while the label kept saying 30.
// The seed may be anchored; the app is not.
//
// ⚠️ `windowStart()` is a FUNCTION, not a module const. A `Date.now()` evaluated at module scope is
// frozen at the moment the container started, which is the same bug wearing a different hat — the
// window would stop moving until the next deploy.
//
// The elapsed minutes are still computed HERE, on the server, and shipped as a number, so
// SSR === client (no `Date.now()` in a render path).
const WINDOW_DAYS = 30;
const windowStart = () => new Date(Date.now() - WINDOW_DAYS * 86_400_000);

export type CartItem = { handle?: string; name: string; variant?: string; qty: number; price: number };
export type CheckoutStep = "keranjang" | "kontak" | "alamat" | "pengiriman" | "pembayaran";

export type AbandonedCart = {
  id: string;
  name: string | null; // null = anonymous (never reached the contact form)
  phone: string | null; // THE field: recovery in Indonesia travels on WhatsApp
  email: string | null;
  city: string | null;
  customerId: string | null; // set when the cart belongs to someone who has bought here before
  step: CheckoutStep;
  items: CartItem[];
  itemsCount: number;
  subtotal: number;
  minutesAgo: number;
  waHref: string | null; // wa.me deep link, message pre-filled from the `keranjang` wa_template
  contactedLabel: string | null; // "WA dibuka" timestamp of the last recorded contact attempt
};

export type CheckoutMetrics = {
  windowDays: number;
  abandoned: number; // checkout_sessions.status = 'ditinggal'
  // RESCUED, not merely "pulih". Every order has a checkout session behind it, and those sessions end
  // up `pulih` too — but they never went quiet, so `abandoned_at` is NULL on them (0045). Counting
  // them as recoveries would report a ~100% recovery rate to a shop that has never saved one cart.
  //   rescued = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL
  rescued: number;
  orders: number; // orders placed in the window = checkouts that completed
  withPhone: number; // abandoned carts carrying a phone number
  anonymous: number; // abandoned - withPhone: nothing to act on, and the screen says so
  notContacted: number; // has a phone, and we have never recorded opening WhatsApp on it
  abandonedValue: number; // sum(subtotal_idr) of the abandoned
  rescuedValue: number; // sum(subtotal_idr) of the rescued
  abandonRate: number; // abandoned / (abandoned + orders)
  recoveryRate: number; // rescued / (abandoned + rescued)
};

// Live sessions (`aktif`) are deliberately excluded from BOTH sides: nobody has abandoned anything
// yet — the shopper is still typing. Counting them as abandoned would be a lie by twenty minutes.
export async function getCheckoutMetrics(): Promise<CheckoutMetrics> {
  return withCurrentTenant(async (db) => {
    const [ck] = await db
      .select({
        abandoned: sql<number>`count(*) filter (where ${schema.checkoutSessions.status} = 'ditinggal')`.mapWith(Number),
        rescued: sql<number>`count(*) filter (where ${schema.checkoutSessions.abandonedAt} is not null and ${schema.checkoutSessions.recoveredAt} is not null)`.mapWith(Number),
        withPhone: sql<number>`count(*) filter (where ${schema.checkoutSessions.status} = 'ditinggal' and ${schema.checkoutSessions.phone} is not null)`.mapWith(Number),
        abandonedValue: sql<number>`coalesce(sum(${schema.checkoutSessions.subtotalIdr}) filter (where ${schema.checkoutSessions.status} = 'ditinggal'), 0)`.mapWith(Number),
        rescuedValue: sql<number>`coalesce(sum(${schema.checkoutSessions.subtotalIdr}) filter (where ${schema.checkoutSessions.abandonedAt} is not null and ${schema.checkoutSessions.recoveredAt} is not null), 0)`.mapWith(Number),
      })
      .from(schema.checkoutSessions)
      .where(gte(schema.checkoutSessions.createdAt, windowStart()));

    // A placed order IS a completed checkout — including one later cancelled, because the checkout
    // still finished. That is the denominator the abandonment rate needs.
    const [o] = await db
      .select({ orders: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.orders)
      .where(gte(schema.orders.placedAt, windowStart()));

    // Never had WhatsApp opened on them: an abandoned cart with a phone whose number carries no
    // `keranjang` follow-up with a sent_at. Digits-only on both sides, so "0812…" and "62812…" of
    // the same person do not read as two different people.
    const [nc] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.checkoutSessions)
      .where(
        and(
          eq(schema.checkoutSessions.status, "ditinggal"),
          gte(schema.checkoutSessions.createdAt, windowStart()),
          isNotNull(schema.checkoutSessions.phone),
          // QUALIFIED ON PURPOSE. Drizzle emits an interpolated column UNQUALIFIED, and followups
          // has its OWN phone column, so this compared f.phone to f.phone -- true for every row with
          // a phone. The NOT EXISTS then went FALSE the moment ANY 'keranjang' follow-up had ever
          // been sent to anybody, so this count collapsed to zero for the whole store rather than
          // excluding the sessions already contacted. See the class guard in packages/db.
          sql`not exists (
            select 1 from followups f
             where f.type = 'keranjang' and f.sent_at is not null
               and regexp_replace(f.phone, '\D', '', 'g') = regexp_replace("checkout_sessions"."phone", '\D', '', 'g')
          )`,
        ),
      );

    const abandoned = ck?.abandoned ?? 0;
    const rescued = ck?.rescued ?? 0;
    const orders = o?.orders ?? 0;
    const withPhone = ck?.withPhone ?? 0;
    return {
      windowDays: WINDOW_DAYS,
      abandoned,
      rescued,
      orders,
      withPhone,
      anonymous: abandoned - withPhone,
      notContacted: Number(nc?.n ?? 0),
      abandonedValue: ck?.abandonedValue ?? 0,
      rescuedValue: ck?.rescuedValue ?? 0,
      abandonRate: abandoned + orders > 0 ? abandoned / (abandoned + orders) : 0,
      recoveryRate: abandoned + rescued > 0 ? rescued / (abandoned + rescued) : 0,
    };
  });
}

// Priority order = what a merchant would actually work down, in this order:
//   1. it has a phone number (no phone → nothing to act on, WhatsApp is the whole recovery channel)
//   2. basket value, decayed by age — a fresh Rp500rb cart beats a three-week-old Rp900rb one
// Everything else (step, city) is context, not ranking.
function score(subtotal: number, minutesAgo: number): number {
  return subtotal / (1 + minutesAgo / 1440); // halves after ~1 day, /8 after a week
}

// The screen loads the top `withPhone` carts a merchant can actually act on, PLUS a slice of the
// anonymous ones so the "Anonim" tab is not a lie by omission — phone-first ranking alone would push
// every anonymous cart off the end of the list and make it look like every cart has a number.
// The tab counts on screen come from `getCheckoutMetrics()` (the true totals), not from this slice.
export async function getAbandonedCarts(withPhoneLimit = 100, anonymousLimit = 40): Promise<AbandonedCart[]> {
  // The store's own name for the {{toko}} placeholder — by session storeId, never "the first store
  // in the table" (there are 7 of them).
  const session = await getSession();
  const storeName = (session ? await getStoreName(session.storeId) : null) ?? "Toko";
  // The canonical host the recovery link must point at — resolved ONCE for the whole list, not per
  // cart (it is the same store for every row, and it costs a query).
  const host = session ? await getStorefrontHost(session.storeId) : null;

  return withCurrentTenant(async (db) => {
    const rows = await db
      .select()
      .from(schema.checkoutSessions)
      .where(and(eq(schema.checkoutSessions.status, "ditinggal"), gte(schema.checkoutSessions.createdAt, windowStart())))
      .orderBy(desc(schema.checkoutSessions.createdAt));

    // The `keranjang` WhatsApp template the CRM already ships — the same one the CRM sends from.
    // It finally has a real cart to point at.
    const [tpl] = await db
      .select({ body: schema.waTemplates.body })
      .from(schema.waTemplates)
      .where(eq(schema.waTemplates.type, "keranjang"))
      .limit(1);

    // Contact attempts we have RECORDED (a `keranjang` followup with a sent_at). This says "we opened
    // WhatsApp on this number", nothing more — wa.me cannot tell us the message was delivered or read,
    // so nothing here claims it was.
    const contacts = await db
      .select({ phone: schema.followups.phone, sentAt: schema.followups.sentAt })
      .from(schema.followups)
      .where(and(eq(schema.followups.type, "keranjang"), isNotNull(schema.followups.sentAt)));
    const lastContact = new Map<string, Date>();
    for (const c of contacts) {
      const key = digits(c.phone ?? "");
      if (!key || !c.sentAt) continue;
      const prev = lastContact.get(key);
      if (!prev || c.sentAt > prev) lastContact.set(key, c.sentAt);
    }

    // ── THE LINK IS MINTED HERE, AND IT IS THE WHOLE POINT OF THE MESSAGE ────────────────────────
    //
    // Until this existed the WhatsApp body carried {nama, produk, toko} and NO WAY BACK — the shopper
    // was told their cart was waiting and given nothing to tap. `signRecoveryToken` had zero callers
    // across all four apps, so every downstream piece (the verifier, the "Selamat datang kembali"
    // banner, the basket restore, the field pre-fill) was live but unreachable.
    //
    // Minted ONLY for carts with a phone: without one there is no WhatsApp to send, and a token is a
    // credential — do not create ones nobody can use. `sessionId` (not `r.id`) is what the storefront
    // looks the row up by.
    //
    // ⚠️ `Promise.all` because minting is async (HS256 sign). Do not "simplify" this back to a sync
    // `.map` by hoisting one token out of the loop — a token is bound to ONE session id.
    const carts = await Promise.all(
      rows.map(async (r): Promise<AbandonedCart> => {
        const items = ((r.items as CartItem[] | null) ?? []).filter((i) => i && i.name);
        const last = r.updatedAt ?? r.createdAt;
        const contactedAt = r.phone ? lastContact.get(digits(r.phone)) : undefined;
        const link = r.phone && host ? await recoveryUrl(host, r.storeId, r.sessionId) : null;
        return {
          id: r.id,
          name: r.name,
          phone: r.phone,
          email: r.email,
          city: r.city,
          customerId: r.customerId,
          step: r.step as CheckoutStep,
          items,
          itemsCount: items.reduce((a, i) => a + i.qty, 0),
          subtotal: r.subtotalIdr,
          minutesAgo: Math.max(0, Math.round((Date.now() - last.getTime()) / 60_000)),
          waHref: r.phone && tpl ? waLink(r.phone, cartMessage(tpl.body, r.name, items, storeName, link)) : null,
          contactedLabel: contactedAt ? formatContact(contactedAt) : null,
        };
      }),
    );

    const byScore = (a: AbandonedCart, b: AbandonedCart) =>
      score(b.subtotal, b.minutesAgo) - score(a.subtotal, a.minutesAgo);
    const phoned = carts.filter((c) => c.phone).sort(byScore).slice(0, withPhoneLimit);
    const anonymous = carts.filter((c) => !c.phone).sort(byScore).slice(0, anonymousLimit);
    return [...phoned, ...anonymous];
  });
}

// One cart, for the recovery action (server-side, so the message text is never client-supplied).
export async function getAbandonedCart(id: string) {
  return withCurrentTenant(async (db) => {
    const [r] = await db.select().from(schema.checkoutSessions).where(eq(schema.checkoutSessions.id, id)).limit(1);
    return r ?? null;
  });
}

export { cartMessage };

export const digits = (s: string) => s.replace(/\D/g, "");

// Absolute, not relative: a contact attempt is a real wall-clock event (the merchant clicked it),
// and a date says exactly what happened, when — no arithmetic to get wrong.
function formatContact(d: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  }).format(d);
}
