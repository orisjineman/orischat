// 링크 미리보기의 SSRF 방어: 기본 설정(사설 주소 차단)에서는 내부망/로컬 주소를 절대 열지 않음.
delete process.env.LINK_PREVIEW_ALLOW_PRIVATE;
const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getLinkPreview, isPrivateAddress } = require('../lib/linkPreview');

let internal;
let hitCount = 0;
let port;

before(async () => {
  internal = http.createServer((req, res) => {
    hitCount++;
    res.setHeader('content-type', 'text/html');
    res.end('<title>내부 서비스</title>');
  });
  await new Promise((r) => internal.listen(0, '127.0.0.1', r));
  port = internal.address().port;
});

after(() => internal.close());

test('로컬/사설/링크로컬 주소는 IP로 직접 적어도, 도메인이 그쪽을 가리켜도 열지 않는다', async () => {
  for (const url of [
    `http://127.0.0.1:${port}/`,
    `http://localhost:${port}/`,
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://10.0.0.5/',
    'http://192.168.0.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/latest/meta-data/', // 클라우드 메타데이터 서버
    'http://0.0.0.0/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/', // 127.0.0.1의 정수 표기 (URL 파서가 정규화함)
    'http://0x7f.1/',
  ]) {
    assert.equal(await getLinkPreview(url), false, url);
  }
  assert.equal(hitCount, 0, '내부 서버에 요청이 도달하면 안 됨');
});

test('기본 포트(80/443)가 아닌 포트는 공개 주소여도 거부한다', async () => {
  assert.equal(await getLinkPreview('http://example.com:8080/'), false);
  assert.equal(await getLinkPreview('https://example.com:22/'), false);
});

test('isPrivateAddress: 공인 주소는 통과, 사설·예약 대역은 차단', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  for (const ip of ['127.0.0.1', '10.255.255.255', '172.31.0.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1', 'not-an-ip']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});
