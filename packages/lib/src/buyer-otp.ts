import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// Buyer account sign-in code (TokoΦ Account, Task 10.1 / ACC-1, ACC-2). Pure logic only: the challenge
// row, its table and the delivery channel are later tasks. What lives here is the part that must be
// identical everywhere it is checked: how a code is made, what is stored instead of it, and the order
// in which a submitted code is refused.

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;

/** Six digits from the CSPRNG. `Math.random` would make the code guessable from earlier codes. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * What the database stores instead of the code. Bound to the phone so a hash lifted from one
 * challenge cannot be replayed against another number; keyed so a leaked table cannot be brute-forced
 * offline (10^6 codes is nothing without the key).
 */
export function hashOtp(phone: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`buyer-otp:${phone}:${code}`).digest("hex");
}

export type OtpChallenge = {
  phone: string;
  codeHash: string;
  expiresAt: number; // epoch ms
  attempts: number; // wrong submissions so far
  consumedAt: number | null;
};

export type OtpVerdict = "ok" | "malformed" | "consumed" | "expired" | "locked" | "wrong";

/**
 * Order matters: a used or dead challenge is refused before the code is even compared, so a correct
 * code can never revive it, and a locked challenge stays locked even for the right code. The caller
 * increments `attempts` on "wrong" and sets `consumedAt` on "ok" in the same statement that read it.
 */
export function checkOtp(ch: OtpChallenge, submitted: string, secret: string, now = Date.now()): OtpVerdict {
  const code = submitted.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return "malformed";
  if (ch.consumedAt !== null) return "consumed";
  if (now >= ch.expiresAt) return "expired";
  if (ch.attempts >= OTP_MAX_ATTEMPTS) return "locked";
  const a = Buffer.from(hashOtp(ch.phone, code, secret), "hex");
  const b = Buffer.from(ch.codeHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "wrong";
}

/** REQ-003's 60-second resend cooldown, measured from the last code actually sent. */
export function resendAfterMs(lastSentAt: number | null, now = Date.now()): number {
  if (lastSentAt === null) return 0;
  return Math.max(0, lastSentAt + OTP_RESEND_COOLDOWN_MS - now);
}

/** Delivery channel seam. The real provider (WhatsApp/SMS) is an open owner decision. */
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

/**
 * Local development only: prints the code instead of sending it. Refuses to exist in a production
 * build, so a missing provider fails loudly instead of logging live codes.
 */
export function devOtpSender(log: (line: string) => void = console.info): OtpSender {
  if (process.env.NODE_ENV === "production") throw new Error("devOtpSender is not allowed in production");
  return {
    async send(phone, code) {
      log(`[dev-otp] ${phone} → ${code}`);
    },
  };
}
