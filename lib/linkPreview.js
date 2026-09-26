// 링크 미리보기: 메시지 속 URL의 제목/설명/썸네일(OpenGraph)을 서버가 대신 가져옴.
//
// 서버가 사용자가 준 주소를 직접 열기 때문에 SSRF(서버를 이용해 내부망을 찌르는 공격)를
// 막는 게 핵심임:
//  - http/https, 기본 포트(80/443)만 허용
//  - 접속하려는 IP가 사설/루프백/링크로컬/예약 대역이면 거부 (IP 직접 입력, DNS 조회 결과 모두)
//  - 실제로 연결에 쓰는 IP를 검사한 그 IP로 고정 (DNS 재바인딩 방지: lookup 훅에서 검사)
//  - 리다이렉트는 최대 3번, 매번 처음부터 다시 검사
//  - 응답 크기/시간 제한, HTML만 파싱
//  - 썸네일은 서버가 받아서 작은 JPEG data URL로 만들어 내려줌 (보는 사람 브라우저가 외부
//    사이트에 직접 접속하지 않게 해서 IP 노출/추적 픽셀을 막음)
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const sharp = require('sharp');
const { LINK_PREVIEW_ALLOW_PRIVATE, MAX } = require('./config');

const HTML_MAX_BYTES = 1.5 * 1024 * 1024; // 유튜브처럼 <head> 앞쪽에 큰 스크립트가 있는 페이지도 있음
const IMAGE_MAX_BYTES = 2.5 * 1024 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const THUMB_SIZE = 176;
const CACHE_HIT_MS = 60 * 60 * 1000;
const CACHE_MISS_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;
const MAX_CONCURRENT_FETCHES = 8; // 서버 전체 기준 — 여러 소켓이 한꺼번에 몰려도 자원이 안 고갈되게

function isPrivateIPv4(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // 멀티캐스트/예약
  );
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) {
    const v6 = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPrivateIPv4(mapped[1]);
    if (v6 === '::' || v6 === '::1') return true;
    if (/^f[cd]/.test(v6)) return true; // fc00::/7 (유니크 로컬)
    if (/^fe[89ab]/.test(v6)) return true; // fe80::/10 (링크 로컬)
    if (v6.startsWith('ff')) return true; // 멀티캐스트
    if (v6.startsWith('64:ff9b:')) return true; // NAT64
    if (v6.startsWith('2001:db8')) return true; // 문서용
    return false;
  }
  return true; // IP 형식이 아니면 믿지 않음
}

// http.request의 lookup 훅: 여기서 검사한 주소로만 실제 연결이 이뤄짐
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, family: options && options.family }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || (!LINK_PREVIEW_ALLOW_PRIVATE && addresses.some((a) => isPrivateAddress(a.address)))) {
      return callback(new Error('허용되지 않는 주소입니다'));
    }
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http/https만 허용');
  if (url.username || url.password) throw new Error('인증 정보가 포함된 주소는 허용 안 함');
  if (!LINK_PREVIEW_ALLOW_PRIVATE && url.port && url.port !== '80' && url.port !== '443') throw new Error('허용되지 않는 포트');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !LINK_PREVIEW_ALLOW_PRIVATE && isPrivateAddress(host)) throw new Error('허용되지 않는 주소');
  return host;
}

function requestOnce(url, { maxBytes, accept, stopAtHeadEnd = false }) {
  return new Promise((resolve, reject) => {
    const host = checkUrl(url);
    const lib = url.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    };

    const req = lib.request(
      {
        hostname: host,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; OrisChatLinkPreview/1.0)',
          accept,
          'accept-language': 'ko,en;q=0.8',
        },
        lookup: guardedLookup,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        let tail = Buffer.alloc(0);
        res.on('data', (chunk) => {
          size += chunk.length;
          chunks.push(chunk);
          // 메타데이터는 <head> 안에만 있으므로 </head>가 나오면 더 안 받음
          let sawHeadEnd = false;
          if (stopAtHeadEnd) {
            const window = Buffer.concat([tail, chunk]);
            sawHeadEnd = window.toString('latin1').toLowerCase().includes('</head');
            tail = window.subarray(-6);
          }
          if (size >= maxBytes || sawHeadEnd) {
            req.destroy(); // 필요한 만큼만 받고 끊음
            finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).subarray(0, maxBytes), truncated: true });
          }
        });
        res.on('end', () => finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated: false }));
        res.on('error', (err) => finish(reject, err));
      }
    );
    const deadline = setTimeout(() => {
      req.destroy();
      finish(reject, new Error('시간 초과'));
    }, TIMEOUT_MS);
    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

// 리다이렉트를 따라가며 가져옴 (홉마다 다시 검사됨)
async function safeGet(urlString, opts) {
  let url = new URL(urlString);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    return { ...res, finalUrl: url.toString() };
  }
  throw new Error('리다이렉트가 너무 많음');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const clean = (s, max) => decodeEntities(String(s || '')).replace(/\s+/g, ' ').trim().slice(0, max);

// HTML 앞부분에서 OpenGraph/트위터 카드/title 메타데이터를 뽑음
function parseMeta(html, baseUrl) {
  const meta = {};
  for (const tag of html.match(/<meta\s[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = clean(meta['og:title'] || meta['twitter:title'] || (titleTag && titleTag[1]), 120);
  const description = clean(meta['og:description'] || meta['twitter:description'] || meta.description, 200);
  const siteName = clean(meta['og:site_name'], 60);

  let image = null;
  const rawImage = (meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || '').trim();
  if (rawImage) {
    try {
      const abs = new URL(decodeEntities(rawImage), baseUrl);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') image = abs.toString();
    } catch {
      image = null;
    }
  }
  return { title, description, siteName, image };
}

function decodeBody(buffer, contentType) {
  let charset = (/charset=["']?([\w-]+)/i.exec(contentType || '') || [])[1];
  if (!charset) charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buffer.subarray(0, 2048).toString('latin1')) || [])[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

async function fetchThumbnail(imageUrl) {
  try {
    const res = await safeGet(imageUrl, { maxBytes: IMAGE_MAX_BYTES, accept: 'image/*' });
    const type = String(res.headers['content-type'] || '').toLowerCase();
    if (res.status !== 200 || !type.startsWith('image/') || type.includes('svg') || res.truncated) return null;
    const jpeg = await sharp(res.body, { failOn: 'none', limitInputPixels: 40_000_000 })
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}

async function buildPreview(urlString) {
  const res = await safeGet(urlString, { maxBytes: HTML_MAX_BYTES, accept: 'text/html,application/xhtml+xml', stopAtHeadEnd: true });
  const type = String(res.headers['content-type'] || '').toLowerCase();
  if (res.status !== 200 || !/html|xml/.test(type)) return false;

  const { title, description, siteName, image } = parseMeta(decodeBody(res.body, type), res.finalUrl);
  if (!title && !description) return false;
  return {
    url: urlString,
    title,
    description,
    siteName: siteName || new URL(res.finalUrl).hostname.replace(/^www\./, ''),
    image: image ? await fetchThumbnail(image) : null,
  };
}

const cache = new Map(); // url -> { at, ttl, value }
const inflight = new Map(); // url -> Promise

// 미리보기 객체, 미리보기를 만들 수 없으면 false, 지금 서버가 바빠서 처리하지 못했으면 null(나중에 재시도 가능)
async function getLinkPreview(urlString) {
  const raw = String(urlString || '').trim();
  if (!raw || raw.length > MAX.URL) return false;
  let normalized;
  try {
    normalized = new URL(raw).toString();
    checkUrl(new URL(normalized));
  } catch {
    return false;
  }

  const hit = cache.get(normalized);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  if (inflight.has(normalized)) return inflight.get(normalized);
  if (inflight.size >= MAX_CONCURRENT_FETCHES) return null;

  const job = buildPreview(normalized)
    .catch(() => false)
    .then((value) => {
      if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
      cache.set(normalized, { at: Date.now(), ttl: value ? CACHE_HIT_MS : CACHE_MISS_MS, value });
      return value;
    })
    .finally(() => inflight.delete(normalized));
  inflight.set(normalized, job);
  return job;
}

module.exports = { getLinkPreview, isPrivateAddress, parseMeta, decodeEntities };
