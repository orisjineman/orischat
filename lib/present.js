// 서버 내부 데이터를 "보는 사람 기준"으로 바꿔서 클라이언트에 내려줄 형태로 만듦.
// 실제 clientId는 절대 내려주지 않고 "내 것인지"만 알려줌.
const { rememberMessage } = require('./state');

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
  for (const m of rows) rememberMessage(m.id, m.clientId, room);
  return rows.map((m) => toClientMessage(m, viewerClientId));
}

module.exports = { reactionsForViewer, toClientMessage, toClientMessages };
