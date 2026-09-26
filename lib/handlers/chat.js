// 채팅 메시지 전송
const crypto = require('crypto');
const path = require('path');
const db = require('../../db');
const push = require('../../push');
const { GIF_URL_MAX_LENGTH, IMAGE_MAX_LENGTH, MAX } = require('../config');
const { snapshotOf } = require('../present');
const { limiters } = require('../rateLimiter');
const { detectMentions, rememberMessage } = require('../state');
const { listStickers } = require('../stickers');
const { isValidGifUrl, isValidImageDataUrl } = require('../validation');

// 페이로드에서 { type, content }를 뽑아 검증함. 무시해야 하는 요청이면 null을 돌려주고,
// 사용자에게 알려야 하는 오류(이미지 용량 등)는 여기서 직접 upload-error로 보냄.
function parseContent(socket, data) {
  if (data.type === 'sticker') {
    // 경로 조작(../ 등) 방지 + 실제 존재하는 스티커 파일인지 검증
    const filename = path.basename(String(data.content || ''));
    if (!listStickers().includes(filename)) return null;
    return { type: 'sticker', content: filename };
  }

  if (data.type === 'image') {
    // 클라이언트가 이미 리사이즈/압축해서 보내지만, 용량 상한은 서버에서도 강제함
    // (무료 DB 용량을 지키기 위함 — 7일 지나면 자동 삭제되긴 하지만 그 전까지 쌓일 수 있음)
    const dataUrl = String(data.content || '');
    if (!isValidImageDataUrl(dataUrl, IMAGE_MAX_LENGTH)) {
      socket.emit('upload-error', '이미지 용량이 너무 큽니다. 더 작은 사진으로 시도해주세요.');
      return null;
    }
    return { type: 'image', content: dataUrl };
  }

  if (data.type === 'gif') {
    const url = String(data.content || '');
    if (!isValidGifUrl(url, GIF_URL_MAX_LENGTH)) return null;
    return { type: 'gif', content: url };
  }

  const message = String(data.content || '').trim().slice(0, MAX.MESSAGE);
  if (!message) return null;
  return { type: 'text', content: message };
}

// 답장 대상은 클라이언트가 보내는 스냅샷(id/닉네임/미리보기)을 그대로 신뢰하되
// 길이만 제한함 — 원본이 나중에 삭제되어도 답장 미리보기는 그대로 남게 하기 위함
function parseReplyTo(replyTo) {
  if (!replyTo || !replyTo.id) return null;
  return {
    id: String(replyTo.id).slice(0, MAX.REPLY_ID),
    nickname: String(replyTo.nickname || '').slice(0, MAX.NICKNAME),
    preview: String(replyTo.preview || '').slice(0, MAX.REPLY_PREVIEW),
  };
}

function register(socket, { emit }) {
  socket.on('chat-message', async (payload) => {
    if (!limiters.message.check(socket.id)) {
      socket.emit('rate-limited', { action: 'chat-message' });
      return;
    }

    const { nickname, clientId, room } = socket.data;
    if (!nickname || !clientId || !room) return; // join 하지 않은 소켓의 요청은 무시

    // 문자열(구버전 클라이언트)과 { type, content, replyTo } 객체 둘 다 지원
    const data = typeof payload === 'string' ? { type: 'text', content: payload } : payload || {};

    const parsed = parseContent(socket, data);
    if (!parsed) return;
    const { type, content } = parsed;

    const id = crypto.randomUUID();
    const time = Date.now();
    const replyTo = parseReplyTo(data.replyTo);
    const mentions = type === 'text' ? detectMentions(content, room) : [];

    rememberMessage(id, clientId, room, snapshotOf({ type, content, nickname, time }));

    if (db.enabled) {
      try {
        await db.insertMessage({ id, type, content, nickname, clientId, room, time, replyTo });
      } catch (err) {
        console.error('메시지 저장 오류:', err);
      }
    }

    const base = { id, type, content, nickname, time, replyTo, mentions, edited: false };
    emit.emitPersonalized(room, 'chat-message', (s) => ({
      ...base,
      mine: s.data.clientId === clientId,
      reactions: {},
    }));

    push.notifyRoom(room, { nickname, excludeClientId: clientId }).catch((err) => console.error('푸시 알림 오류:', err));
  });
}

module.exports = { register };
