-- ─────────────────────────────────────────────────────────────────────────────
-- 0048 — every WhatsApp number becomes canonical `62xxxxxxxxx`.
--
-- Prod stored `08124612804` (local format, 24/24 customers). KiriminAja books against `62…`, wa.me
-- links need `62…`, and the same person landed twice as `0812…` and `+62 812…` because nothing
-- agreed on a shape. From now on `/api/public/order` normalises on write (@tokophi/lib/validate →
-- normalizePhone); this migration brings the rows already in the table up to the same shape.
--
-- The rule is STRUCTURAL, not carrier-based: strip separators, drop the `0`/`62`/`620` prefix, and
-- require what remains to start with `8` and be 9–12 digits. NO hard-coded operator prefixes
-- (811/812/813/821/…) — carriers add prefixes, and a prefix table would one day silently refuse a
-- real customer on a brand-new number.
--
-- Numbers that CANNOT be parsed (landlines, junk, empty) are LEFT EXACTLY AS THEY ARE. A migration
-- that deletes data it does not understand is worse than the inconsistency it set out to fix.
-- The helper is dropped at the end: the TypeScript in @tokophi/lib/validate is the single source of
-- truth, and a second copy in SQL would drift from it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tokophi_norm_phone(p text) RETURNS text AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF left(d, 3) = '620' THEN d := substr(d, 4);
  ELSIF left(d, 2) = '62' THEN d := substr(d, 3);
  ELSIF left(d, 1) = '0' THEN d := regexp_replace(d, '^0+', '');
  END IF;
  IF left(d, 1) <> '8' THEN RETURN NULL; END IF;          -- Indonesian mobiles are 8xx
  IF length(d) < 9 OR length(d) > 12 THEN RETURN NULL; END IF;
  RETURN '62' || d;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint
UPDATE customers SET phone = tokophi_norm_phone(phone)
 WHERE tokophi_norm_phone(phone) IS NOT NULL AND phone IS DISTINCT FROM tokophi_norm_phone(phone);
--> statement-breakpoint
UPDATE orders SET ship_phone = tokophi_norm_phone(ship_phone)
 WHERE tokophi_norm_phone(ship_phone) IS NOT NULL AND ship_phone IS DISTINCT FROM tokophi_norm_phone(ship_phone);
--> statement-breakpoint
UPDATE customer_addresses SET phone = tokophi_norm_phone(phone)
 WHERE tokophi_norm_phone(phone) IS NOT NULL AND phone IS DISTINCT FROM tokophi_norm_phone(phone);
--> statement-breakpoint
UPDATE checkout_sessions SET phone = tokophi_norm_phone(phone)
 WHERE tokophi_norm_phone(phone) IS NOT NULL AND phone IS DISTINCT FROM tokophi_norm_phone(phone);
--> statement-breakpoint
UPDATE leads SET phone = tokophi_norm_phone(phone)
 WHERE tokophi_norm_phone(phone) IS NOT NULL AND phone IS DISTINCT FROM tokophi_norm_phone(phone);
--> statement-breakpoint
UPDATE followups SET phone = tokophi_norm_phone(phone)
 WHERE tokophi_norm_phone(phone) IS NOT NULL AND phone IS DISTINCT FROM tokophi_norm_phone(phone);
--> statement-breakpoint
UPDATE wa_messages SET phone = tokophi_norm_phone(phone)
 WHERE tokophi_norm_phone(phone) IS NOT NULL AND phone IS DISTINCT FROM tokophi_norm_phone(phone);
--> statement-breakpoint
UPDATE chat_visitors SET phone = tokophi_norm_phone(phone)
 WHERE tokophi_norm_phone(phone) IS NOT NULL AND phone IS DISTINCT FROM tokophi_norm_phone(phone);
--> statement-breakpoint
-- The seller's own pickup phone rides on the KiriminAja booking (sender.phone) — same format, same
-- rule. `suppliers.phone` is deliberately NOT touched: a supplier's number may legitimately be a
-- landline, and this rule would have nothing true to say about it.
UPDATE store_settings SET sender_phone = tokophi_norm_phone(sender_phone)
 WHERE tokophi_norm_phone(sender_phone) IS NOT NULL AND sender_phone IS DISTINCT FROM tokophi_norm_phone(sender_phone);
--> statement-breakpoint
DROP FUNCTION tokophi_norm_phone(text);
