// 메시지 고정/해제 (방 안의 누구나 가능, 방마다 개수 상한 있음)
const db = require('../../db');
const pinStore = require('../pinStore');
const { MAX, MAX_PINS_PER_ROOM } = require('../config');
const { previewOf } = require('../present');
const { limiters } = require('../rateLimiter');
const { getMessageMeta } = require('../state');

// 고정할 메시지의 작성자/미리보기 정보. 서버 캐시에 있으면 그걸 쓰고, 없으면 DB에서 찾음
// (클라이언트가 보낸 내용을 믿지 않고 서버가 아는 원본으로만 고정함)
async function findMessageSummary(id) {
  const meta = getMessageMeta(id);
  if (meta && meta.type) return meta;
  if (!db.enabled) return null;
  const row = await db.getMessageById(id);
  if (!row) return null;
  return { room: row.room, type: row.type, preview: previewOf(row.type, row.content), nickname: row.nickname, time: row.time };
}

function register(socket, { emit }) {
  socket.on('pin-message', async ({ messageId } = {}) => {
    if (!limiters.pin.check(socket.id)) {
      socket.emit('rate-limited', { action: 'pin' });
      return;
    }
    const { room, clientId } = socket.data;
    if (!room || !clientId || !messageId) return;

    const id = String(messageId).slice(0, MAX.REPLY_ID);
    try {
      const summary = await findMessageSummary(id);
      if (!summary || summary.room !== room) {
        socket.emit('pin-error', '고정할 수 없는 메시지예요.');
        return;
      }
      const result = await pinStore.addPin(
        room,
        { id, type: summary.type, preview: summary.preview, nickname: summary.nickname, time: summary.time, pinnedAt: Date.now() },
        MAX_PINS_PER_ROOM
      );
      if (result === 'full') {
        socket.emit('pin-error', `고정은 방마다 최대 ${MAX_PINS_PER_ROOM}개까지 할 수 있어요. 하나를 해제하고 다시 시도해주세요.`);
        return;
      }
      if (result === 'ok') await emit.broadcastPins(room);
    } catch (err) {
      console.error('메시지 고정 오류:', err);
    }
  });

  socket.on('unpin-message', async ({ messageId } = {}) => {
    if (!limiters.pin.check(socket.id)) return;
    const { room, clientId } = socket.data;
    if (!room || !clientId || !messageId) return;

    try {
      if (await pinStore.removePin(room, String(messageId).slice(0, MAX.REPLY_ID))) await emit.broadcastPins(room);
    } catch (err) {
      console.error('고정 해제 오류:', err);
    }
  });
}

module.exports = { register };
