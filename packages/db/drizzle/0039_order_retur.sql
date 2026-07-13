-- COD went live (0038) and we still could not record its single biggest cost.
--
-- `order_status` was baru | diproses | dikirim | selesai | batal. There was no way to say a parcel
-- CAME BACK. A refused COD delivery is not `batal`: a cancelled order never shipped, a returned one
-- did — and someone paid to move it twice. Collapsing the two makes the return rate invisible, and
-- the return rate is the entire justification for the SPX-only COD policy (a refused parcel ships
-- back free on SPX and is billed to the merchant elsewhere).
--
-- So today the question "what is our COD return rate, per courier?" is unanswerable, and every
-- decision about widening COD beyond SPX is a guess. `orders` already carries `courier`, so once
-- the status exists the answer is a `group by`.
--
-- NOTE for whoever writes the next enum migration: ALTER TYPE ... ADD VALUE is allowed inside a
-- transaction on PG12+, but the new label cannot be USED in that same transaction. Adding it here
-- and only referencing it from later statements/app code is deliberate — do not try to backfill
-- rows to 'retur' in this file.
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'retur';--> statement-breakpoint

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "return_reason" text;
