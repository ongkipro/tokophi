/// <reference types="astro/client" />

// Populated per request by src/middleware.ts (Host → store → catalog). Every page/component
// reads the tenant from here — never from a module-level singleton.
declare namespace App {
  interface Locals {
    store: import("./data/store").StoreInfo;
    catalog: import("./data/catalog").Catalog;
  }
}
