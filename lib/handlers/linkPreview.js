// 링크 미리보기 요청. 입장한 소켓만, 도배 방지 제한 안에서 처리함.
// 콜백 값: 미리보기 객체 | false(미리보기 없음, 결과로 확정) | null(요청이 거절됨 — 나중에 다시 시도해도 됨)
const { MAX } = require('../config');
const { getLinkPreview } = require('../linkPreview');
const { limiters } = require('../rateLimiter');

function register(socket) {
  socket.on('link-preview', async ({ url } = {}, callback) => {
    if (typeof callback !== 'function') return;
    if (!socket.data.room) return callback(null);
    if (!limiters.linkPreview.check(socket.id)) return callback(null);

    try {
      callback(await getLinkPreview(String(url || '').slice(0, MAX.URL + 1)));
    } catch (err) {
      console.error('링크 미리보기 오류:', err.message);
      callback(false);
    }
  });
}

module.exports = { register };
