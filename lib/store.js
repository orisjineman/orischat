// 리액션/프로필 사진 저장소. DB(Turso)가 켜져 있으면 db.js에 맡기고, 없으면(로컬 개발
// 등) 메모리에 저장하는 폴백을 씀. 호출하는 쪽은 어느 쪽인지 신경 쓰지 않아도 됨.
const db = require('../db');

// 메시지별 반응(이모지 리액션) 메모리 폴백: messageId -> { emoji -> Set of clientId }
const memoryReactions = new Map();

// 프로필 사진 메모리 폴백: nickname -> { image, updatedAt }
const memoryAvatars = new Map();

// 이미 누른 반응이면 취소, 아니면 추가한 뒤 { emoji: [clientId, ...] } 요약을 반환
async function toggleReaction(messageId, emoji, clientId) {
  if (db.enabled) return db.toggleReaction(messageId, emoji, clientId);

  if (!memoryReactions.has(messageId)) memoryReactions.set(messageId, new Map());
  const byEmoji = memoryReactions.get(messageId);
  if (!byEmoji.has(emoji)) byEmoji.set(emoji, new Set());
  const clientIds = byEmoji.get(emoji);

  if (clientIds.has(clientId)) {
    clientIds.delete(clientId);
    if (clientIds.size === 0) byEmoji.delete(emoji);
  } else {
    clientIds.add(clientId);
  }

  const summary = {};
  for (const [e, ids] of byEmoji.entries()) {
    summary[e] = Array.from(ids);
  }
  return summary;
}

// 메시지가 삭제될 때 메모리에 남은 리액션도 지움 (DB 쪽은 db.deleteMessage가 함께 지움)
function forgetReactions(messageId) {
  memoryReactions.delete(messageId);
}

async function setAvatar(nickname, dataUrl) {
  if (db.enabled) return db.setAvatar(nickname, dataUrl);
  memoryAvatars.set(nickname, { image: dataUrl, updatedAt: Date.now() });
}

// { image, updatedAt } 또는 없으면 null
async function getAvatar(nickname) {
  if (db.enabled) return db.getAvatar(nickname);
  return memoryAvatars.get(nickname) || null;
}

module.exports = { toggleReaction, forgetReactions, setAvatar, getAvatar };
