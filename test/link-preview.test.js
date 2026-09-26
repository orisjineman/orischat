// 링크 미리보기: 로컬에 가짜 웹 서버를 띄워서 OpenGraph 파싱, 썸네일 변환, 리다이렉트, 캐시,
// 실패 케이스를 확인함. 로컬(사설 IP) 서버를 쓰려고 허용 스위치를 켜므로 이 파일만 따로 실행됨.
process.env.LINK_PREVIEW_ALLOW_PRIVATE = '1';
const http = require('http');
const sharp = require('sharp');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getLinkPreview, parseMeta } = require('../lib/linkPreview');
const { server, start } = require('../server');
const { setBaseUrl, withClients } = require('./helpers/socket-harness');

let web;
let base;
const hits = {};
let png;

before(async () => {
  png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3366cc' } }).png().toBuffer();
  web = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    const html = (body, type = 'text/html; charset=utf-8') => {
      res.setHeader('content-type', type);
      res.end(body);
    };
    switch (req.url) {
      case '/ok':
        return html(`<html><head>
          <title>무시될 title</title>
          <meta property="og:title" content="멋진 &amp; 제목 &#39;따옴표&#39;">
          <meta property="og:description" content="설명입니다.
             여러 줄이어도 한 줄로">
          <meta property="og:site_name" content="예시 사이트">
          <meta property="og:image" content="/thumb.png">
        </head><body>본문</body></html>`);
      case '/title-only':
        return html('<html><head><title>  제목만   있는 페이지 </title></head></html>');
      case '/nothing':
        return html('<html><head></head><body>메타 없음</body></html>');
      case '/thumb.png':
        res.setHeader('content-type', 'image/png');
        return res.end(png);
      case '/redirect':
        res.statusCode = 302;
        res.setHeader('location', '/ok');
        return res.end();
      case '/loop':
        res.statusCode = 302;
        res.setHeader('location', '/loop');
        return res.end();
      case '/json':
        return html('{"a":1}', 'application/json');
      case '/broken-image':
        return html('<html><head><meta property="og:title" content="깨진 이미지"><meta property="og:image" content="/bad.png"></head></html>');
      case '/bad.png':
        res.setHeader('content-type', 'image/png');
        return res.end('이건 png가 아님');
      case '/svg-image':
        return html('<html><head><meta property="og:title" content="svg"><meta property="og:image" content="/x.svg"></head></html>');
      case '/x.svg':
        res.setHeader('content-type', 'image/svg+xml');
        return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
      case '/slow':
        return; // 응답을 안 줌 → 시간 초과
      case '/euckr': {
        res.setHeader('content-type', 'text/html; charset=euc-kr');
        return res.end(Buffer.from('3c7469746c653ec7d1b1b93c2f7469746c653e', 'hex')); // <title>한국</title> (EUC-KR)
      }
      default:
        res.statusCode = 404;
        return html('없음');
    }
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${web.address().port}`;
  setBaseUrl(`http://localhost:${await start(0)}`);
});

after(() => {
  server.close();
  web.closeAllConnections?.();
  web.close();
});

test('OpenGraph 제목/설명/사이트명을 읽고, HTML 엔티티와 공백을 정리하며, 썸네일은 작은 JPEG data URL로 준다', async () => {
  const p = await getLinkPreview(`${base}/ok`);
  assert.equal(p.title, "멋진 & 제목 '따옴표'");
  assert.equal(p.description, '설명입니다. 여러 줄이어도 한 줄로');
  assert.equal(p.siteName, '예시 사이트');
  assert.match(p.image, /^data:image\/jpeg;base64,/);
  const thumb = await sharp(Buffer.from(p.image.split(',')[1], 'base64')).metadata();
  assert.deepEqual([thumb.width, thumb.height], [176, 176]);
  assert.ok(p.image.length < 20_000);
});

test('og 태그가 없으면 <title>로 대체하고, 사이트명은 호스트로, 이미지는 null', async () => {
  const p = await getLinkPreview(`${base}/title-only`);
  assert.equal(p.title, '제목만 있는 페이지');
  assert.equal(p.siteName, '127.0.0.1');
  assert.equal(p.image, null);
});

test('제목도 설명도 없거나, HTML이 아니거나, 404면 false', async () => {
  assert.equal(await getLinkPreview(`${base}/nothing`), false);
  assert.equal(await getLinkPreview(`${base}/json`), false);
  assert.equal(await getLinkPreview(`${base}/missing`), false);
});

test('리다이렉트는 따라가고, 무한 리다이렉트는 포기한다', async () => {
  assert.equal((await getLinkPreview(`${base}/redirect`)).title, "멋진 & 제목 '따옴표'");
  assert.equal(await getLinkPreview(`${base}/loop`), false);
});

test('썸네일이 깨졌거나 SVG면 이미지만 빼고 카드는 만든다', async () => {
  assert.equal((await getLinkPreview(`${base}/broken-image`)).image, null);
  assert.equal((await getLinkPreview(`${base}/svg-image`)).image, null);
  assert.equal((await getLinkPreview(`${base}/broken-image`)).title, '깨진 이미지');
});

test('EUC-KR 같은 다른 인코딩 페이지도 제목이 읽힌다', async () => {
  assert.equal((await getLinkPreview(`${base}/euckr`)).title, '한국');
});

test('같은 주소는 캐시되어 서버를 다시 열지 않고, 동시에 여러 번 물어도 한 번만 연다', async () => {
  const url = `${base}/ok?cache=1`;
  await Promise.all([getLinkPreview(url), getLinkPreview(url), getLinkPreview(url)]);
  await getLinkPreview(url);
  assert.equal(hits['/ok?cache=1'], 1);
});

test('http/https가 아니거나 형식이 이상하거나 너무 길면 false (서버를 열지 않음)', async () => {
  for (const bad of ['', 'ftp://example.com/', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url', `http://a.com/${'x'.repeat(600)}`, 'http://user:pw@example.com/']) {
    assert.equal(await getLinkPreview(bad), false, bad);
  }
});

test('응답이 없는 서버는 시간 초과로 false', { timeout: 15000 }, async () => {
  assert.equal(await getLinkPreview(`${base}/slow`), false);
});

test('parseMeta: 따옴표 종류/속성 순서/대소문자가 달라도 읽고, 상대 이미지 주소는 절대 주소로', () => {
  const m = parseMeta(
    `<META CONTENT='홑따옴표 제목' PROPERTY='og:title'><meta name="description" content=설명없는따옴표><meta property="og:image" content="../img/a.png">`,
    'https://example.com/a/b/page'
  );
  assert.equal(m.title, '홑따옴표 제목');
  assert.equal(m.description, '설명없는따옴표');
  assert.equal(m.image, 'https://example.com/a/img/a.png');
  assert.equal(parseMeta('<meta property="og:image" content="javascript:alert(1)"><title>t</title>', 'https://x.com/').image, null);
});

test('소켓 이벤트: 입장한 사람만 미리보기를 받고, 없으면 false, 입장 전에는 null', async () => {
  const { connectClient, closeClient } = require('./helpers/socket-harness');
  await withClients([{ nickname: 'lp', room: 'lp-room' }], async ([sock]) => {
    const ok = await new Promise((resolve) => sock.emit('link-preview', { url: `${base}/ok` }, resolve));
    assert.equal(ok.title, "멋진 & 제목 '따옴표'");
    assert.equal(await new Promise((resolve) => sock.emit('link-preview', { url: `${base}/nothing` }, resolve)), false);
  });
  const lurker = connectClient();
  try {
    await new Promise((r) => lurker.once('connect', r));
    assert.equal(await new Promise((resolve) => lurker.emit('link-preview', { url: `${base}/ok` }, resolve)), null);
  } finally {
    await closeClient(lurker);
  }
});
