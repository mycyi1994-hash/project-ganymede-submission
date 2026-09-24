import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { env } from 'cloudflare:workers';
import { EngineRepository } from '../lib/engine/repository.ts';
import { GET, POST, DELETE } from '../app/api/portfolio/route.ts';
function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../drizzle/0000_giant_speedball.sql", import.meta.url), "utf8"));
  const db = { readOnly: false, prepare(query) {
    if (this.readOnly && !/^\s*SELECT/i.test(query)) throw Error("Unexpected write on a read-only request");
    const prepared = sql.prepare(query);
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return prepared.get(...args) ?? null; },
      async all() { return { results: prepared.all(...args) }; },
      async run() { return { success: true, meta: { changes: prepared.run(...args).changes } }; },
    };
  }, async batch(statements) { return Promise.all(statements.map((s) => s.run())); } };
  return { db, sql, changes: () => Number(sql.prepare("SELECT total_changes() n").get().n) };
}

const wallet = '0x' + '1'.repeat(40);
const request = (cookie, method = 'GET', payload, extra = {}) => new Request('https://example.test/api/portfolio', {
  method, headers: { ...(cookie ? {cookie} : {}), ...(payload ? {'content-type':'application/json'} : {}), ...extra },
  ...(payload ? {body:JSON.stringify(payload)} : {}),
});
const view = async cookie => (await GET(request(cookie))).json();

test('separate visitors isolate real ledger reads, saves and removals despite identical wallet addresses', async () => {
  const {db, sql} = database(); env.DB=db; env.TRADING_MODE='paper';
  try {
    const repo = new EngineRepository(db); await repo.seed();
    const productId = (await repo.listProducts())[0].id;
    await repo.createSubscription({subject:'paper:private-site-owner',productId,amountKrw:100000n,clientReference:'legacy'});
    const a=await GET(request()), b=await GET(request());
    assert.equal(a.status,200); assert.equal(b.status,200);
    const ca=a.headers.get('set-cookie').split(';')[0], cb=b.headers.get('set-cookie').split(';')[0];
    assert.notEqual(ca,cb);
    assert.match(a.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict; Max-Age=2592000/);
    assert.equal((await a.json()).subscriptions.length,0);
    const saveA=await POST(request(ca,'POST',{productId,amountKrw:'100000',walletAddress:wallet}));
    assert.equal(saveA.status,201,await saveA.text());
    assert.equal((await (await GET(request(cb,'GET',undefined,{'x-ganymede-wallet':wallet}))).json()).subscriptions.length,0);
    const saveB=await POST(request(cb,'POST',{productId,amountKrw:'200000',walletAddress:wallet}));
    assert.equal(saveB.status,201,await saveB.text());
    const va=await view(ca), vb=await view(cb);
    assert.notEqual(va.investor.id,vb.investor.id);
    assert.equal(va.subscriptions.length,1); assert.equal(vb.subscriptions.length,1);
    assert.equal(va.subscriptions[0].amount_krw,'100000');
    // Only settle in this isolated SQLite ledger, never the production engine.
    await repo.settleSubscription((await repo.listSubscriptionsForProcessing(true)).find(r=>r.investor_id===va.investor.id),null,true);
    const sharesMicros=(await view(ca)).positions[0].sharesMicros;
    const denied=await DELETE(request(cb,'DELETE',{productId,sharesMicros,walletAddress:wallet}));
    assert.equal(denied.status,400); assert.match((await denied.json()).error,/Insufficient/);
    assert.equal((await view(ca)).positions[0].sharesMicros,sharesMicros);
    const removed=await DELETE(request(ca,'DELETE',{productId,sharesMicros}));
    assert.equal(removed.status,201,await removed.text());
    await repo.settleRedemption((await repo.listRedemptionsForProcessing(true)).find(r=>r.investor_id===va.investor.id),null,true);
    assert.equal((await view(ca)).positions.length,0);
    assert.equal((await view(cb)).redemptions.length,0);
    assert.equal((await GET(request(ca))).headers.get('set-cookie'),null);
  } finally { delete env.DB; delete env.TRADING_MODE; sql.close(); }
});

test('missing sessions, forged identity headers, cross-site requests and live-mode paper cookies fail closed', async () => {
  env.TRADING_MODE='paper';
  try {
    for(const cookie of [undefined,'__Host-ganymede-paper=bad']) {
      for(const [handler,method] of [[POST,'POST'],[DELETE,'DELETE']]) {
        assert.equal((await handler(request(cookie,method,{productId:'core',amountKrw:'100000',sharesMicros:'1',walletAddress:wallet},{'oai-authenticated-user-email':'owner@example.test'}))).status,401);
      }
    }
    for(const [handler,method] of [[GET,'GET'],[POST,'POST'],[DELETE,'DELETE']]) {
      assert.equal((await handler(request(undefined,method,method==='GET'?undefined:{},{origin:'https://attacker.test'}))).status,403);
    }
    env.TRADING_MODE='live';
    assert.equal((await GET(request('__Host-ganymede-paper='+'a'.repeat(64)))).status,401);
  } finally {delete env.TRADING_MODE;}
});
