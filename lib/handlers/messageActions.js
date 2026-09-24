// 내가 쓴 메시지의 삭제/수정
const db = require('../../db');
const store = require('../store');
const { MAX } = require('../config');
const { limiters } = require('../rateLimiter');
const { forgetMessage, getMessageMeta } = require('../state');

function register(socket, { io }) {
  // 본인이 쓴 메시지만 삭제 가능 (clientId가 작성자와 일치할 때만)
  socket.on('delete-message', async ({ messageId } = {}) => {
    if (!limiters.delete.check(socket.id)) return;

    const { clientId, room } = socket.data;
    if (!clientId || !room || !messageId) return;

    const meta = getMessageMeta(messageId);
    if (!meta || meta.clientId !== clientId || meta.room !== room) return;

    forgetMessage(messageId);
    store.forgetReactions(messageId);

    if (db.enabled) {
      try {
        await db.deleteMessage(messageId, clientId);
      } catch (err) {
        console.error('메시지 삭제 오류:', err);
      }
    }

    io.to(room).emit('message-deleted', { messageId });
  });

  // 본인이 쓴 텍스트 메시지만 수정 가능. DB 없이는 원본을 서버가 따로 갖고 있지
  // 않아서(한 번 브로드캐스트하고 끝) 수정 기능 자체가 동작하지 않음.
  socket.on('edit-message', async ({ messageId, content } = {}) => {
    if (!limiters.edit.check(socket.id)) return;

    const { clientId, room } = socket.data;
    if (!clientId || !room || !messageId || !db.enabled) return;

    const meta = getMessageMeta(messageId);
    if (meta && (meta.clientId !== clientId || meta.room !== room)) return;

    const newContent = String(content || '').trim().slice(0, MAX.MESSAGE);
    if (!newContent) return;

    try {
      const editedAt = await db.editMessage(messageId, clientId, newContent);
      if (!editedAt) return; // 본인 메시지가 아니거나 이미지/스티커 등 텍스트가 아님
      io.to(room).emit('message-edited', { messageId, content: newContent, editedAt });
    } catch (err) {
      console.error('메시지 수정 오류:', err);
    }
  });
}

module.exports = { register };
