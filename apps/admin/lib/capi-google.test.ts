import { afterEach, describe, expect, it, vi } from "vitest";
import { sendGa4Purchase, type ServerEvent } from "./capi";
import { clientContextFromRequest } from "./tracking-events";

const originalSgtmEndpoint = process.env.GOOGLE_SGTM_ENDPOINT;

const EVENT: ServerEvent = {
  eventName: "Purchase",
  eventId: "purchase:WEB-1042",
  eventTime: 1_723_456_789,
  value: 225_000,
  goods: 200_000,
  shipping: 20_000,
  tax: 5_000,
  currency: "IDR",
  contentIds: ["1042-1"],
  numItems: 2,
  orderNumber: "WEB-1042",
  sourceUrl: "https://batik.example/checkout/sukses",
  lineItems: [{ id: "1042-1", price: 100_000, qty: 2 }],
  identity: { email: "Budi.Santoso@gmail.com", phone: "628123456789" },
  client: { gclid: "paid-click-123", gbraid: "ios-click-456" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSgtmEndpoint === undefined) delete process.env.GOOGLE_SGTM_ENDPOINT;
  else process.env.GOOGLE_SGTM_ENDPOINT = originalSgtmEndpoint;
});

describe("Google Ads click context", () => {
  it("decodes the session _gcl cookies into bounded conversion match keys", () => {
    const req = new Request("https://api.example/order", {
      headers: { origin: "https://batik.example", "user-agent": "Browser/1.0" },
    });

    expect(
      clientContextFromRequest(req, "203.0.113.4", {
        gcl: "GCL.1723456789.paid-click-123",
      }),
    ).toMatchObject({ gclid: "paid-click-123", gbraid: null });

    expect(
      clientContextFromRequest(req, "203.0.113.4", {
        gcl: "GB.1.ios-click-456",
      }),
    ).toMatchObject({ gclid: null, gbraid: "ios-click-456" });
  });
});

describe("sendGa4Purchase", () => {
  it("dispatches a purchase payload that an sGTM Google Ads tag can route and attribute", async () => {
    process.env.GOOGLE_SGTM_ENDPOINT = "https://sgtm.example.test/events/";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendGa4Purchase({
      measurementId: "G-ABC123",
      apiSecret: "secret-123",
      clientId: "111.222",
      adsSendTo: "AW-123456789/AbC-D_efGh",
      event: EVENT,
    });

    expect(result).toEqual({ ok: true, retryable: false });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(rawUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://sgtm.example.test/events/mp/collect");
    expect(url.searchParams.get("measurement_id")).toBe("G-ABC123");
    expect(url.searchParams.get("api_secret")).toBe("secret-123");

    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      client_id: "111.222",
      timestamp_micros: EVENT.eventTime * 1_000_000,
      events: [
        {
          name: "purchase",
          params: {
            transaction_id: "WEB-1042",
            event_id: "purchase:WEB-1042",
            send_to: "AW-123456789/AbC-D_efGh",
            gclid: "paid-click-123",
            gbraid: "ios-click-456",
            page_location: "https://batik.example/checkout/sukses",
            value: 200_000,
            shipping: 20_000,
            tax: 5_000,
            currency: "IDR",
            items: [{ item_id: "1042-1", price: 100_000, quantity: 2 }],
          },
        },
      ],
    });
  });
});
