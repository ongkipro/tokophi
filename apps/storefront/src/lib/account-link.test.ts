import { describe, expect, it } from "vitest";
import { accountClaimUrl } from "./account-link";

describe("accountClaimUrl — the success page's 'Simpan ke Akun TokoΦ' target", () => {
  it("is the account origin's /klaim, whatever path the env carries", () => {
    expect(accountClaimUrl("https://account.tokophi.com", true)).toBe("https://account.tokophi.com/klaim");
    expect(accountClaimUrl(" https://account.tokophi.com/x/ ", true)).toBe("https://account.tokophi.com/klaim");
  });
  it("is off when unset, junk, or carrying credentials", () => {
    for (const v of [undefined, "", "account.tokophi.com", "javascript:alert(1)", "https://u:p@account.tokophi.com"]) {
      expect(accountClaimUrl(v, true), String(v)).toBeNull();
    }
  });
  it("plain http only outside a production build — the link carries a claim token", () => {
    expect(accountClaimUrl("http://localhost:4329", true)).toBeNull();
    expect(accountClaimUrl("http://localhost:4329", false)).toBe("http://localhost:4329/klaim");
  });
});
