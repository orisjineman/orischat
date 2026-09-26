// GIPHY_API_KEY가 없으면 GIF 검색은 꺼져 있고 503을 돌려준다.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
delete process.env.GIPHY_API_KEY;
const { server, start } = require('../server');
const { setBaseUrl, getBaseUrl } = require('./helpers/socket-harness');

before(async () => setBaseUrl(`http://localhost:${await start(0)}`));
after(() => server.close());

test('키가 없으면 /api/gifs는 503', async () => {
  assert.equal((await fetch(`${getBaseUrl()}/api/gifs?q=a`)).status, 503);
});
