import assert from "node:assert/strict";
import test from "node:test";
import { env } from "cloudflare:workers";
import { operatorIdentity, requestIdentity } from "../lib/engine/api-helpers.ts";

const HEADER = "oai-authenticated-user-email";

function request(headers = {}) {
  return new Request("https://ganymede.test/api/operations/run", { method: "POST", headers });
}

function configure(values) {
  for (const key of ["IDENTITY_HEADER_TRUSTED", "OPERATIONS_ALLOW_EMAILS", "OPERATOR_TOKEN", "TRADING_MODE"]) delete env[key];
  Object.assign(env, values);
}

test("a client-supplied identity header grants nothing by default", async () => {
  configure({});
  assert.equal(await operatorIdentity(request({ [HEADER]: "attacker@example.com" })), null);
  // Without the trusted-edge flag or a private session cookie there is no investor identity at all.
  assert.equal(await requestIdentity(request({ [HEADER]: "attacker@example.com" })), null);
});

test("the header identifies operators only where the platform sets it", async () => {
  configure({ IDENTITY_HEADER_TRUSTED: "true" });
  assert.equal(await operatorIdentity(request({ [HEADER]: "Ops@Example.com" })), "operator:ops@example.com");
  assert.equal((await requestIdentity(request({ [HEADER]: "ops@example.com" })))?.subject, "email:ops@example.com");

  configure({ IDENTITY_HEADER_TRUSTED: "true", OPERATIONS_ALLOW_EMAILS: "ops@example.com" });
  assert.equal(await operatorIdentity(request({ [HEADER]: "ops@example.com" })), "operator:ops@example.com");
  assert.equal(await operatorIdentity(request({ [HEADER]: "other@example.com" })), null);
});

test("the bearer token works without a trusted header", async () => {
  configure({ OPERATOR_TOKEN: "secret-token" });
  assert.equal(await operatorIdentity(request({ authorization: "Bearer secret-token" })), "operator:token");
  assert.equal(await operatorIdentity(request({ authorization: "Bearer wrong-token" })), null);
  assert.equal(await operatorIdentity(request({ authorization: "Bearer secret-token", [HEADER]: "attacker@example.com" })), "operator:token");
});
