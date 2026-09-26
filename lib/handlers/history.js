// 지난 대화 조회: 검색, 이전 메시지 더 보기 (둘 다 DB가 있어야 의미가 있음)
const db = require('../../db');
const { HISTORY_PAGE_SIZE, JUMP_LOAD_LIMIT, MAX, SEARCH_RESULT_LIMIT } = require('../config');
const { toClientMessages } = require('../present');
const { limiters } = require('../rateLimiter');

function register(socket) {
  // 방 안 메시지 검색 (DB 없으면 검색할 과거 기록이 없으므로 빈 배열만 응답)
  socket.on('search-messages', async ({ query } = {}, callback) => {
    if (typeof callback !== 'function') return;
    if (!limiters.search.check(socket.id)) return callback([]);

    const { room, clientId } = socket.data;
    const q = String(query || '').trim().slice(0, MAX.SEARCH_QUERY);
    if (!room || !clientId || !db.enabled || !q) return callback([]);

    try {
      callback(toClientMessages(await db.searchMessages(room, q, SEARCH_RESULT_LIMIT), room, clientId));
    } catch (err) {
      console.error('검색 오류:', err);
      callback([]);
    }
  });

  // "이전 메시지 더 보기" — DB가 없으면 더 볼 과거 기록이 없으므로 빈 배열만 응답
  socket.on('load-more', async ({ beforeTime } = {}, callback) => {
    if (typeof callback !== 'function') return;
    if (!limiters.loadMore.check(socket.id)) return callback([]);

    const { room, clientId } = socket.data;
    if (!room || !clientId || !db.enabled || !beforeTime) return callback([]);

    try {
      callback(toClientMessages(await db.getMessagesBefore(room, beforeTime, HISTORY_PAGE_SIZE), room, clientId));
    } catch (err) {
      console.error('이전 메시지 조회 오류:', err);
      callback([]);
    }
  });

  // 검색 결과 클릭 시: 화면에 이미 있는 가장 오래된 메시지(beforeTime)부터 찾는 메시지 시각(fromTime)까지 한 번에 불러옴
  socket.on('load-until', async ({ fromTime, beforeTime } = {}, callback) => {
    if (typeof callback !== 'function') return;
    if (!limiters.loadMore.check(socket.id)) return callback([]);

    const { room, clientId } = socket.data;
    const from = Number(fromTime);
    const before = Number(beforeTime);
    if (!room || !clientId || !db.enabled || !Number.isFinite(from) || !Number.isFinite(before) || from >= before) {
      return callback([]);
    }

    try {
      callback(toClientMessages(await db.getMessagesBetween(room, from, before, JUMP_LOAD_LIMIT), room, clientId));
    } catch (err) {
      console.error('메시지 구간 조회 오류:', err);
      callback([]);
    }
  });
}

module.exports = { register };
