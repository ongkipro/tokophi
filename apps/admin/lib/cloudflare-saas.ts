function errorDetail(body: unknown): string {
  if (!body || typeof body !== "object" || !("errors" in body) || !Array.isArray(body.errors)) return "";
  return body.errors
    .map((error) =>
      error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "",
    )
    .filter(Boolean)
    .join("; ");
}

function parseHostname(value: unknown): CustomHostname {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !("hostname" in value) || typeof value.hostname !== "string") {
    throw new Error("Cloudflare mengembalikan data hostname yang tidak valid.");
  }
  const status = "status" in value && typeof value.status === "string" ? value.status : undefined;
  const sslStatus =
    "ssl" in value &&
    value.ssl !== null &&
    typeof value.ssl === "object" &&
    "status" in value.ssl &&
    typeof value.ssl.status === "string"
      ? value.ssl.status
      : undefined;
  return {
    id: value.id,
    hostname: value.hostname,
    status,
    ssl: sslStatus ? { status: sslStatus } : undefined,
  };
}

export type CustomHostname = {
  id: string;
  hostname: string;
  status?: string;
  ssl?: { status?: string };
};

export type DomainProvisioningState = {
  status: "provisioning" | "active" | "error";
  certStatus: string | null;
  error: string | null;
};

type Fetcher = typeof fetch;

const API_BASE = "https://api.cloudflare.com/client/v4";
const ACTIVE_HOST_STATUSES: Record<string, true> = {
  active: true,
  test_active: true,
  test_active_apex: true,
};
const TERMINAL_HOST_STATUSES: Record<string, true> = {
  blocked: true,
  deleted: true,
  moved: true,
  test_blocked: true,
  test_failed: true,
};
const TERMINAL_SSL_STATUSES: Record<string, true> = {
  deleted: true,
  expired: true,
  inactive: true,
  initializing_timed_out: true,
  validation_timed_out: true,
  issuance_timed_out: true,
  deployment_timed_out: true,
  deletion_timed_out: true,
};

function config(): { zoneId: string; token: string } {
  const zoneId = process.env.CF_SAAS_ZONE_ID?.trim();
  const token = process.env.CF_SAAS_API_TOKEN?.trim();
  if (!zoneId || !token) {
    throw new Error("Aktivasi custom domain belum dikonfigurasi oleh platform.");
  }
  return { zoneId, token };
}

async function request(path: string, init: RequestInit, fetcher: Fetcher): Promise<unknown> {
  const { token } = config();
  let response: Response;
  try {
    response = await fetcher(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Cloudflare tidak dapat dihubungi. Aktivasi akan dicoba lagi.");
  }

  const body: unknown = await response.json().catch(() => null);
  const success = body !== null && typeof body === "object" && "success" in body && body.success === true;
  const hasResult = body !== null && typeof body === "object" && "result" in body;
  if (!response.ok || !success || !hasResult) {
    throw new Error(errorDetail(body) || `Cloudflare menolak permintaan (${response.status}).`);
  }
  return body.result;
}

export function provisioningState(hostname: CustomHostname): DomainProvisioningState {
  const hostStatus = hostname.status ?? "unknown";
  const certStatus = hostname.ssl?.status ?? null;
  if (ACTIVE_HOST_STATUSES[hostStatus] && certStatus === "active") {
    return { status: "active", certStatus, error: null };
  }
  if (TERMINAL_HOST_STATUSES[hostStatus] || (certStatus && TERMINAL_SSL_STATUSES[certStatus])) {
    return {
      status: "error",
      certStatus,
      error: `Aktivasi gagal (hostname: ${hostStatus}, SSL: ${certStatus ?? "unknown"}). Periksa CNAME lalu coba lagi.`,
    };
  }
  return { status: "provisioning", certStatus, error: null };
}

export async function createCustomHostname(hostname: string, fetcher: Fetcher = fetch): Promise<CustomHostname> {
  const { zoneId } = config();
  return parseHostname(await request(
    `/zones/${encodeURIComponent(zoneId)}/custom_hostnames`,
    {
      method: "POST",
      body: JSON.stringify({
        hostname,
        ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
      }),
    },
    fetcher,
  ));
}

export async function getCustomHostname(id: string, fetcher: Fetcher = fetch): Promise<CustomHostname> {
  const { zoneId } = config();
  return parseHostname(await request(
    `/zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(id)}`,
    { method: "GET" },
    fetcher,
  ));
}

export async function deleteCustomHostname(id: string, fetcher: Fetcher = fetch): Promise<void> {
  const { zoneId } = config();
  await request(
    `/zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    fetcher,
  );
}
