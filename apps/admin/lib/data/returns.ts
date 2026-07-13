import "server-only";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { sql } from "drizzle-orm";

/**
 * COD return rate, per courier.
 *
 * This is the number the whole COD policy is betting on. TokoΦ restricts COD to SPX because a
 * refused parcel is said to ship back free there and to be billed to the merchant elsewhere — but
 * that claim is second-hand (it is a Shopee Seller Center benefit, and we reach SPX through
 * KiriminAja, a different contract) and the API exposes no return field at all. Until we can put a
 * number on it, "SPX only" is a guess wearing a policy's clothes.
 *
 * Now that `orders.status` can be `retur` (migration 0039) and `orders.courier` was already there,
 * the answer is a group by. Two rates, and the difference between them is the point:
 *   - codReturnRate: of COD orders that SHIPPED, how many came back
 *   - nonCodReturnRate: same for prepaid orders
 * If COD's rate is not materially worse than prepaid's, the courier restriction is buying nothing.
 *
 * Denominator = orders that actually shipped (dikirim | selesai | retur). Orders still sitting in
 * `baru`/`diproses` have not had the chance to be refused, and counting them would flatter the rate.
 */
export type CourierReturns = {
  courier: string;
  shipped: number;
  returned: number;
  returnRate: number; // 0..1
  codShipped: number;
  codReturned: number;
  codReturnRate: number; // 0..1
};

export async function getReturnsByCourier(): Promise<CourierReturns[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      with shipped as (
        select
          coalesce(nullif(o.courier, ''), 'Tidak diketahui') as courier,
          o.status = 'retur'                                 as returned,
          exists (
            select 1 from payments p
            where p.order_id = o.id and p.method = 'cod'
          )                                                  as is_cod
        from orders o
        where o.status in ('dikirim', 'selesai', 'retur')
      )
      select
        courier                                                   as "courier",
        count(*)::int                                             as "shipped",
        count(*) filter (where returned)::int                     as "returned",
        count(*) filter (where is_cod)::int                       as "codShipped",
        count(*) filter (where is_cod and returned)::int          as "codReturned"
      from shipped
      group by 1
      order by 2 desc
    `)) as unknown as {
      courier: string; shipped: number; returned: number; codShipped: number; codReturned: number;
    }[];

    return rows.map((r) => {
      const shipped = Number(r.shipped);
      const returned = Number(r.returned);
      const codShipped = Number(r.codShipped);
      const codReturned = Number(r.codReturned);
      return {
        courier: r.courier,
        shipped,
        returned,
        returnRate: shipped ? returned / shipped : 0,
        codShipped,
        codReturned,
        codReturnRate: codShipped ? codReturned / codShipped : 0,
      };
    });
  });
}
