import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const report = JSON.stringify({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://x.test/a.png?token=SECRET", "document-uri": "https://rich.tokophi.com/toko?q=1" } });
const post = (body: string, headers: Record<string, string> = {}) => POST(new Request("http://x/api/csp-report", { method: "POST", body, headers }));

afterEach(() => vi.restoreAllMocks());

describe("/api/csp-report (Super Admin)", () => {
  it("logs ONE query-stripped line and answers 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await post(report);
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe("[csp-report] directive=img-src blocked=https://x.test/a.png doc=https://rich.tokophi.com/toko");
  });
  it("answers 204 and logs nothing for junk", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post("not json")).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
  it("refuses an oversized body by its declared length (413), before reading it", async () => {
    expect((await post("{}", { "content-length": "999999" })).status).toBe(413);
  });
});
