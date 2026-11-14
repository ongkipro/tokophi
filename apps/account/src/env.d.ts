/// <reference types="astro/client" />

// Set per request by src/middleware.ts from the `tphi_account` cookie → `buyer_sessions` row.
declare namespace App {
  interface Locals {
    account: import("./data/account").Account | null;
    sessionId: string | null;
  }
}
