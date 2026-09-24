// 읽음 표시와 "입력 중" 표시
const { limiters } = require('../rateLimiter');
const { setLastRead } = require('../state');

function register(socket, { emit }) {
  // 읽음 표시: "이 시각까지의 메시지를 봤다"고 알려줌. 방에 있는 모두가 특정
  // 메시지 시각 이상으로 읽음 표시를 하면, 그 메시지를 보낸 사람 화면에
  // "읽음"이 뜸.
  socket.on('mark-read', ({ time } = {}) => {
    if (!limiters.read.check(socket.id)) return;

    const { room, clientId } = socket.data;
    if (!room || !clientId || !time) return;

    if (setLastRead(room, clientId, time)) emit.broadcastReadUpdate(room);
  });

  socket.on('typing', (isTyping) => {
    const { nickname, room } = socket.data;
    if (!nickname || !room) return;
    socket.broadcast.to(room).emit('typing', { nickname, isTyping: !!isTyping });
  });
}

module.exports = { register };
