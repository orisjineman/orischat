// 이모지 리액션
const store = require('../store');
const { reactionsForViewer } = require('../present');
const { limiters } = require('../rateLimiter');
const { getMessageMeta } = require('../state');

function register(socket, { emit }) {
  socket.on('react', async ({ messageId, emoji } = {}) => {
    if (!limiters.reaction.check(socket.id)) {
      socket.emit('rate-limited', { action: 'react' });
      return;
    }

    const { clientId, room } = socket.data;
    if (!clientId || !room || !messageId || !emoji) return;

    const meta = getMessageMeta(messageId);
    if (meta && meta.room !== room) return; // 다른 방의 메시지엔 반응할 수 없음

    let summary;
    try {
      summary = await store.toggleReaction(messageId, emoji, clientId);
    } catch (err) {
      console.error('리액션 저장 오류:', err);
      return;
    }

    emit.emitPersonalized(room, 'reaction-update', (s) => ({
      messageId,
      reactions: reactionsForViewer(summary, s.data.clientId),
    }));
  });
}

module.exports = { register };
