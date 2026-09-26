// --- 짧은 시간에 너무 많은 요청을 보내는 걸 막는 간단한 sliding-window rate limiter ---
function createLimiter(maxHits, windowMs) {
  const hits = new Map(); // socket.id -> timestamp[]
  return {
    check(socketId) {
      const now = Date.now();
      const arr = (hits.get(socketId) || []).filter((t) => now - t < windowMs);
      arr.push(now);
      hits.set(socketId, arr);
      return arr.length <= maxHits;
    },
    forget(socketId) {
      hits.delete(socketId);
    },
  };
}

// 이벤트별 제한: [최대 횟수, 윈도우(ms)]
const LIMITS = {
  message: [8, 5000], // 5초에 8개까지
  reaction: [20, 5000],
  loadMore: [10, 10000],
  delete: [10, 10000],
  edit: [10, 10000],
  search: [10, 10000],
  avatar: [5, 60000],
  read: [30, 5000],
  pin: [20, 10000],
  export: [3, 60000],
  linkPreview: [30, 10000],
};

const limiters = Object.fromEntries(
  Object.entries(LIMITS).map(([name, [max, windowMs]]) => [name, createLimiter(max, windowMs)])
);

function forgetSocket(socketId) {
  for (const limiter of Object.values(limiters)) limiter.forget(socketId);
}

module.exports = { createLimiter, limiters, forgetSocket };
