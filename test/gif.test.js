// GIF 검색 프록시(/api/gifs)와 GIF 메시지 검증. 가짜 GIPHY 서버를 띄워서 확인함.
// 환경 변수는 서버 모듈을 불러오기 전에 정해야 해서 이 파일만 따로 실행됨.
const http = require('http');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');

let upstream;
const upstreamCalls = [];
let upstreamStatus = 200;

const fakeGif = (id) => ({
  id,
  images: {
    fixed_width_small: { url: `https://media1.giphy.com/media/${id}/100w.gif`, width: '100', height: '80' },
    fixed_width: { url: `https://media1.giphy.com/media/${id}/200w.gif`, width: '200', height: '160' },
  },
});

before(async () => {
  upstream = http.createServer((req, res) => {
    upstreamCalls.push(req.url);
    res.statusCode = upstreamStatus;
    res.setHeader('content-type', 'application/json');
    const data = [
      fakeGif('ok1'),
      { id: 'evil', images: { fixed_width_small: { url: 'https://evil.example.com/a.gif' }, fixed_width: { url: 'https://evil.example.com/b.gif' } } },
      { id: 'noimg' },
    ];
    res.end(JSON.stringify({ data }));
  });
  await new Promise((r) => upstream.listen(0, r));
  process.env.GIPHY_API_KEY = 'test-key';
  process.env.GIPHY_API_BASE = `http://localhost:${upstream.address().port}/v1/gifs`;
  const { server, start } = require('../server');
  const helpers = require('./helpers/socket-harness');
  helpers.setBaseUrl(`http://localhost:${await start(0)}`);
  module.exports = { server };
});

after(() => {
  require('../server').server.close();
  upstream.close();
});

const { getBaseUrl, waitFor, collectDuring, withClients } = require('./helpers/socket-harness');
const get = (p) => fetch(`${getBaseUrl()}${p}`);

test('/api/config: GIF 기능이 켜져 있음을 알려준다', async () => {
  assert.equal((await (await get('/api/config')).json()).gifEnabled, true);
});

test('검색: GIPHY 결과 중 허용된 CDN 주소만 골라서 내려주고, API 키가 실제 요청에 실린다', async () => {
  const res = await get('/api/gifs?q=' + encodeURIComponent('고양이'));
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.deepEqual(list.map((g) => g.id), ['ok1']);
  assert.equal(list[0].preview, 'https://media1.giphy.com/media/ok1/100w.gif');
  assert.equal(list[0].url, 'https://media1.giphy.com/media/ok1/200w.gif');
  const last = new URL(upstreamCalls.at(-1), 'http://x');
  assert.equal(last.pathname, '/v1/gifs/search');
  assert.equal(last.searchParams.get('api_key'), 'test-key');
  assert.equal(last.searchParams.get('q'), '고양이');
  assert.equal(last.searchParams.get('rating'), 'g');
});

test('검색어가 없으면 인기(trending) GIF를 준다', async () => {
  await get('/api/gifs');
  assert.equal(new URL(upstreamCalls.at(-1), 'http://x').pathname, '/v1/gifs/trending');
});

test('같은 검색어는 잠깐 캐시되어 GIPHY를 다시 호출하지 않는다', async () => {
  await get('/api/gifs?q=cache-me');
  const before = upstreamCalls.length;
  await get('/api/gifs?q=CACHE-ME');
  assert.equal(upstreamCalls.length, before);
});

test('GIPHY가 오류를 돌려주면 502', async () => {
  upstreamStatus = 500;
  try {
    assert.equal((await get('/api/gifs?q=fail-case')).status, 502);
  } finally {
    upstreamStatus = 200;
  }
});

test('GIF 메시지: GIPHY 주소만 전송되고, 다른 주소/형식은 무시된다', async () => {
  await withClients(
    [
      { nickname: 'gif-a', room: 'gif-room' },
      { nickname: 'gif-b', room: 'gif-room' },
    ],
    async ([a, b]) => {
      const okUrl = 'https://media2.giphy.com/media/xyz/200w.gif';
      const got = waitFor(b, 'chat-message', (m) => m.type === 'gif');
      a.emit('chat-message', { type: 'gif', content: okUrl });
      const msg = await got;
      assert.equal(msg.content, okUrl);
      assert.equal(msg.mine, false);

      const bad = collectDuring(b, 'chat-message', () => true, 300);
      for (const content of [
        'https://evil.example.com/a.gif',
        'http://media.giphy.com/media/x/200w.gif',
        'https://media.giphy.com.evil.com/x.gif',
        'javascript:alert(1)',
        'https://media.giphy.com/' + 'a'.repeat(400),
        '',
      ]) {
        a.emit('chat-message', { type: 'gif', content });
      }
      assert.deepEqual(await bad, []);
    }
  );
});
