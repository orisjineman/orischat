// 서버 내부 데이터를 "보는 사람 기준"으로 바꿔서 클라이언트에 내려줄 형태로 만듦.
// 실제 clientId는 절대 내려주지 않고 "내 것인지"만 알려줌.
const { rememberMessage } = require('./state');

// 고정 메시지 등에 보여줄 한 줄 미리보기. 이미지 본문(수백 KB)은 서버 캐시/브로드캐스트에
// 싣지 않도록 라벨만 씀.
function previewOf(type, content) {
  if (type === 'sticker') return '스티커';
  if (type === 'image') return '사진';
  if (type === 'gif') return 'GIF';
  return String(content || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// 작성자 캐시(state.messageMeta)에 같이 기억해둘 가벼운 요약
function snapshotOf(m) {
  return { type: m.type, preview: previewOf(m.type, m.content), nickname: m.nickname, time: m.time };
}

// 리액션 {emoji: [clientId, ...]} 를 보는 사람 기준 {emoji: {count, mine}} 로 변환
function reactionsForViewer(reactionsObj, viewerClientId) {
  const out = {};
  for (const [emoji, ids] of Object.entries(reactionsObj || {})) {
    if (!ids || !ids.length) continue;
    out[emoji] = { count: ids.length, mine: ids.includes(viewerClientId) };
  }
  return out;
}

// DB에서 읽은 메시지 행(row, client_id 포함)을 특정 사용자에게 보낼 형태로 변환.
function toClientMessage(row, viewerClientId) {
  const { clientId, reactions, ...rest } = row;
  return { ...rest, mine: clientId === viewerClientId, reactions: reactionsForViewer(reactions, viewerClientId) };
}

// DB에서 읽은 메시지 목록을 삭제 권한 캐시에 기록하고 viewer용으로 변환
function toClientMessages(rows, room, viewerClientId) {
  for (const m of rows) rememberMessage(m.id, m.clientId, room, snapshotOf(m));
  return rows.map((m) => toClientMessage(m, viewerClientId));
}

module.exports = { previewOf, snapshotOf, reactionsForViewer, toClientMessage, toClientMessages };
