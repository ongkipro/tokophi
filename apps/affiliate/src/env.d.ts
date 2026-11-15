/// <reference types="astro/client" />

// Set per request by src/middleware.ts from the `tphi_affiliate` cookie → `affiliate_sessions` row.
declare namespace App {
  interface Locals {
    account: import("./data/auth").Account | null;
    sessionId: string | null;
  }
}
