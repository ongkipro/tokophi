import { strict as assert } from "node:assert";
import Module from "node:module";

const load = Module._load;
Module._load = function loadAuditDependency(request, parent, isMain) {
  if (request !== "playwright") return load.call(this, request, parent, isMain);

  const page = {
    async goto() {},
    async fill(selector, value) {
      if (selector.includes("email")) assert.equal(value, process.env.AUDIT_EMAIL);
      if (selector.includes("password")) assert.equal(value, process.env.AUDIT_PASSWORD);
    },
    async waitForNavigation() {},
    async click() {},
    url() {
      return `${process.argv[2]}/store/audit-test`;
    },
    async setViewportSize() {},
    async waitForTimeout() {},
    async evaluate() {
      return { overflow: 0, culprits: [] };
    },
  };

  return {
    chromium: {
      async launch() {
        assert.ok(process.env.AUDIT_EMAIL, "browser launched without AUDIT_EMAIL");
        assert.ok(process.env.AUDIT_PASSWORD, "browser launched without AUDIT_PASSWORD");
        return {
          async newContext() {
            return { async newPage() { return page; } };
          },
          async close() {},
        };
      },
    },
  };
};
