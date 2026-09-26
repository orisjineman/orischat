// GIF 검색(GIPHY) 프록시. API 키는 서버에만 두고, 브라우저에는 미리보기/전송용 URL만 내려줌.
const express = require('express');
const { GIF_URL_MAX_LENGTH, GIPHY_API_BASE, GIPHY_API_KEY } = require('./config');
const { createLimiter } = require('./rateLimiter');
const { isValidGifUrl } = require('./validation');

const router = express.Router();

const RESULT_LIMIT = 24;
const SEARCH_CACHE_MS = 60 * 1000;
const TRENDING_CACHE_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

// GIPHY 무료(베타) 키는 시간당 호출 수가 적어서, 같은 검색어는 잠깐 캐시해둠
const cache = new Map(); // key -> { at, ttl, value }
const limiter = createLimiter(30, 60 * 1000); // IP당 분당 30회

function toItem(g) {
  const preview = g.images && g.images.fixed_width_small && g.images.fixed_width_small.url;
  const full = g.images && g.images.fixed_width && g.images.fixed_width.url;
  if (!g.id || !isValidGifUrl(preview, GIF_URL_MAX_LENGTH) || !isValidGifUrl(full, GIF_URL_MAX_LENGTH)) return null;
  return {
    id: g.id,
    preview,
    url: full,
    width: Number(g.images.fixed_width.width) || null,
    height: Number(g.images.fixed_width.height) || null,
  };
}

router.get('/api/gifs', async (req, res) => {
  if (!GIPHY_API_KEY) return res.status(503).json({ error: 'GIF 검색이 설정되지 않았습니다.' });
  if (!limiter.check(req.ip)) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });

  const q = String(req.query.q || '').trim().slice(0, 50);
  const key = q ? `s:${q.toLowerCase()}` : 'trending';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return res.json(hit.value);

  const params = new URLSearchParams({ api_key: GIPHY_API_KEY, limit: String(RESULT_LIMIT), rating: 'g' });
  if (q) params.set('q', q);
  try {
    const upstream = await fetch(`${GIPHY_API_BASE}/${q ? 'search' : 'trending'}?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) return res.status(502).json({ error: 'GIF 서버 응답 오류' });
    const body = await upstream.json();
    const value = (body.data || []).map(toItem).filter(Boolean);

    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), ttl: q ? SEARCH_CACHE_MS : TRENDING_CACHE_MS, value });
    res.json(value);
  } catch (err) {
    console.error('GIF 검색 오류:', err.message);
    res.status(502).json({ error: 'GIF 서버에 연결하지 못했습니다.' });
  }
});

module.exports = { gifsRouter: router };
