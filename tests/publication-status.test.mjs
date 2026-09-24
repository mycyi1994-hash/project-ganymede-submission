import test from "node:test";
import assert from "node:assert/strict";
import { publicationStatus } from "../lib/nav-status.ts";
import { maxQuoteAgeMinutes } from "../lib/xstocks/cycle.ts";

const now = Date.parse("2026-09-24T03:00:00Z");
const recent = { effectiveAt: "2026-09-24T02:59:00Z" };
const latest = { evaluatedAt: "2026-09-24T03:00:00Z", status: "priced", publication: { status: "confirmed" } };

test("recent pricing cannot hide an old publication", () => {
  assert.equal(publicationStatus({ effectiveAt: "2026-09-24T02:00:00Z" }, latest, now).label, "Published record delayed");
  assert.equal(publicationStatus(recent, latest, now).tone, "ready");
});

test("pending, failed and unreadable publications do not appear current", () => {
  for (const [status, expected] of [["queued", "Publication pending"], ["submitted", "Publication pending"], ["failed", "Publication failed"]]) {
    assert.equal(publicationStatus(recent, { ...latest, publication: { status } }, now).label, expected);
  }
  assert.equal(publicationStatus(recent, latest, now, true).label, "Publication status unavailable");
  assert.equal(publicationStatus(null, latest, now).label, "Awaiting publication");
  assert.equal(publicationStatus({ effectiveAt: "invalid" }, latest, now).tone, "waiting");
});

test("public quote-age policy uses the publisher's configured value and fallback", () => {
  assert.equal(maxQuoteAgeMinutes({}), 360);
  assert.equal(maxQuoteAgeMinutes({ XSTOCKS_MAX_QUOTE_AGE_MINUTES: "30" }), 30);
  for (const value of ["0", "-1", "invalid"]) assert.equal(maxQuoteAgeMinutes({ XSTOCKS_MAX_QUOTE_AGE_MINUTES: value }), 360);
});
