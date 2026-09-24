const { placeholders, query, run, whenEnabled } = require('./client');

// 리액션 행들을 { 이모지: [clientId, ...] } 요약에 차곡차곡 담음
function addToSummary(summary, emoji, clientId) {
  if (!summary[emoji]) summary[emoji] = [];
  summary[emoji].push(clientId);
}

// 메시지 여러 개의 리액션을 한 번에 조회: Map<messageId, { 이모지: [clientId, ...] }>
async function reactionsByMessage(messageIds) {
  const byMessage = new Map();
  if (messageIds.length === 0) return byMessage;

  const rows = await query(
    `SELECT message_id as messageId, emoji, client_id as clientId FROM reactions WHERE message_id IN (${placeholders(messageIds.length)})`,
    messageIds
  );
  for (const row of rows) {
    if (!byMessage.has(row.messageId)) byMessage.set(row.messageId, {});
    addToSummary(byMessage.get(row.messageId), row.emoji, row.clientId);
  }
  return byMessage;
}

// 이미 눌렀던 반응이면 취소(토글), 아니면 추가. 최신 반응 요약을 반환함.
const toggleReaction = whenEnabled(
  () => ({}),
  async (messageId, emoji, clientId) => {
    const existing = await query('SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ? AND client_id = ?', [
      messageId,
      emoji,
      clientId,
    ]);

    if (existing.length > 0) {
      await run('DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND client_id = ?', [messageId, emoji, clientId]);
    } else {
      await run('INSERT INTO reactions (message_id, emoji, client_id) VALUES (?, ?, ?)', [messageId, emoji, clientId]);
    }

    const rows = await query('SELECT emoji, client_id as clientId FROM reactions WHERE message_id = ?', [messageId]);
    const summary = {};
    for (const row of rows) addToSummary(summary, row.emoji, row.clientId);
    return summary;
  }
);

module.exports = { toggleReaction, reactionsByMessage };
