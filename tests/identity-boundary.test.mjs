import assert from 'node:assert/strict';
import test from 'node:test';
import { env } from 'cloudflare:workers';
import { requestIdentity, operatorIdentity } from '../lib/engine/api-helpers.ts';

test('public headers cannot impersonate a user or operator; explicit trusted edges and bearer tokens still work', async () => {
  const request = new Request('https://example.test', {headers: {'oai-authenticated-user-email':'operator@example.test'}});
  try {
    env.TRADING_MODE = 'live';
    env.OPERATIONS_ALLOW_EMAILS = 'operator@example.test';
    for (const flag of [undefined, 'false', '0']) {
      env.IDENTITY_HEADER_TRUSTED = flag;
      assert.equal((await requestIdentity(request)), null);
      assert.equal(await operatorIdentity(request), null);
    }
    env.TRADING_MODE = 'paper';
    env.OPERATIONS_ALLOW_EMAILS = '';
    assert.equal(await operatorIdentity(request), null);
    assert.equal(await requestIdentity(request), null);
    env.IDENTITY_HEADER_TRUSTED = 'true';
    assert.equal((await requestIdentity(request)).subject, 'email:operator@example.test');
    assert.equal(await operatorIdentity(request), 'operator:operator@example.test');
    env.IDENTITY_HEADER_TRUSTED = 'false';
    env.OPERATOR_TOKEN = 'test-only-token';
    assert.equal(await operatorIdentity(new Request('https://example.test', {headers:{authorization:'Bearer test-only-token'}})), 'operator:token');
    assert.equal(await operatorIdentity(new Request('https://example.test', {headers:{authorization:'Bearer wrong'}})), null);
  } finally { for(const key of ['TRADING_MODE','OPERATIONS_ALLOW_EMAILS','IDENTITY_HEADER_TRUSTED','OPERATOR_TOKEN']) delete env[key]; }
});
