// 프로필 사진 설정 (닉네임 기준으로 저장 — 방/기기 안 가리고 그 닉네임을 쓰는 동안
// 계속 보임). 클라이언트가 미리 리사이즈해서 보내지만 서버에서도 크기 상한을 강제함.
const store = require('../store');
const { AVATAR_MAX_LENGTH } = require('../config');
const { limiters } = require('../rateLimiter');
const { isValidImageDataUrl } = require('../validation');

function register(socket, { io }) {
  socket.on('set-avatar', async ({ content } = {}) => {
    if (!limiters.avatar.check(socket.id)) return;

    const { nickname } = socket.data;
    if (!nickname) return;

    const dataUrl = String(content || '');
    if (!isValidImageDataUrl(dataUrl, AVATAR_MAX_LENGTH)) {
      socket.emit('upload-error', '프로필 사진 용량이 너무 큽니다. 더 작은 사진으로 시도해주세요.');
      return;
    }

    try {
      await store.setAvatar(nickname, dataUrl);
    } catch (err) {
      console.error('프로필 사진 저장 오류:', err);
      return;
    }

    io.to(socket.data.room).emit('avatar-updated', { nickname, updatedAt: Date.now() });
  });
}

module.exports = { register };
