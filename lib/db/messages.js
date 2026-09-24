const { placeholders, query, run, transaction, whenEnabled } = require('./client');
const { reactionsByMessage } = require('./reactions');

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7일

const MESSAGE_COLUMNS =
  'id, type, content, nickname, client_id as clientId, time, reply_to as replyTo, edited_at as editedAt';

// reply_to는 DB에 JSON 문자열로 저장되어 있어서 객체로 풀어줌
function parseReplyTo(row) {
  let replyTo = null;
  if (row.replyTo) {
    try {
      replyTo = JSON.parse(row.replyTo);
    } catch {
      replyTo = null;
    }
  }
  const { replyTo: _drop, ...rest } = row;
  return { ...rest, replyTo, edited: Boolean(row.editedAt) };
}

// 조회한 메시지 행들을 화면용 형태(답장 정보 풀기 + 리액션 붙이기)로 바꿈
async function hydrate(rows) {
  const messages = rows.map(parseReplyTo);
  const reactions = await reactionsByMessage(messages.map((m) => m.id));
  return messages.map((m) => ({ ...m, reactions: reactions.get(m.id) || {} }));
}

const insertMessage = whenEnabled(
  () => undefined,
  async ({ id, type, content, nickname, clientId, room, time, replyTo }) => {
    await run(
      'INSERT INTO messages (id, type, content, nickname, client_id, room, time, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, type, content, nickname, clientId, room, time, replyTo ? JSON.stringify(replyTo) : null]
    );
  }
);

// 본인 텍스트 메시지만 수정 가능. clientId가 실제 작성자와 일치할 때만 수정하고,
// 성공 시 수정 시각을, 아니면 false를 반환.
const editMessage = whenEnabled(
  () => false,
  async (id, clientId, newContent) => {
    const [row] = await query("SELECT client_id as clientId FROM messages WHERE id = ? AND type = 'text'", [id]);
    if (!row || row.clientId !== clientId) return false;

    const editedAt = Date.now();
    await run('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?', [newContent, editedAt, id]);
    return editedAt;
  }
);

// 방 안 메시지 중 content에 query가 포함된 것을 최신순으로 최대 limit개 반환
const searchMessages = whenEnabled(
  () => [],
  (room, text, limit = 50) =>
    query(
      `SELECT id, type, content, nickname, client_id as clientId, time FROM messages
       WHERE room = ? AND type = 'text' AND content LIKE ? ESCAPE '\\' ORDER BY time DESC LIMIT ?`,
      [room, `%${text.replace(/[\\%_]/g, '\\$&')}%`, limit]
    )
);

// 현재까지 메시지가 한 번이라도 오간 방 목록과, 방별 마지막 활동 시각/메시지 수
const getKnownRooms = whenEnabled(
  () => [],
  (limit = 50) =>
    query(
      `SELECT room, COUNT(*) as messageCount, MAX(time) as lastActivity
       FROM messages GROUP BY room ORDER BY lastActivity DESC LIMIT ?`,
      [limit]
    )
);

// 해당 방의 최근 메시지 최대 limit개를 시간순(오래된 것부터)으로 반환
const getRecentMessages = whenEnabled(
  () => [],
  async (room, limit = 50) => {
    const rows = await query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE room = ? ORDER BY time DESC LIMIT ?`, [room, limit]);
    return hydrate(rows.reverse());
  }
);

// beforeTime보다 이전(오래된) 메시지를 최대 limit개, 시간순(오래된 것부터)으로 반환.
// "이전 메시지 더 보기" 페이지네이션에 사용.
const getMessagesBefore = whenEnabled(
  () => [],
  async (room, beforeTime, limit = 50) => {
    const rows = await query(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE room = ? AND time < ? ORDER BY time DESC LIMIT ?`,
      [room, beforeTime, limit]
    );
    return hydrate(rows.reverse());
  }
);

// 본인 메시지만 삭제 가능. clientId가 실제 작성자와 일치할 때만 삭제하고,
// 성공 시 그 메시지가 있던 room을 반환 (브로드캐스트 범위를 알기 위함).
const deleteMessage = whenEnabled(
  () => null,
  async (id, clientId) => {
    const [row] = await query('SELECT room, client_id as clientId FROM messages WHERE id = ?', [id]);
    if (!row || row.clientId !== clientId) return null;

    await transaction([
      { sql: 'DELETE FROM reactions WHERE message_id = ?', args: [id] },
      { sql: 'DELETE FROM messages WHERE id = ?', args: [id] },
    ]);
    return row.room;
  }
);

// 7일 지난 메시지와 그에 달린 리액션을 DB에서 완전히 삭제
const cleanupOldMessages = whenEnabled(
  () => undefined,
  async () => {
    const cutoff = Date.now() - RETENTION_MS;
    const old = await query('SELECT id FROM messages WHERE time < ?', [cutoff]);
    const ids = old.map((r) => r.id);
    if (ids.length === 0) return;

    await transaction([
      { sql: `DELETE FROM reactions WHERE message_id IN (${placeholders(ids.length)})`, args: ids },
      { sql: `DELETE FROM messages WHERE id IN (${placeholders(ids.length)})`, args: ids },
    ]);
    console.log(`오래된 메시지 ${ids.length}개(7일 경과) 삭제 완료.`);
  }
);

module.exports = {
  insertMessage,
  editMessage,
  searchMessages,
  getKnownRooms,
  getRecentMessages,
  getMessagesBefore,
  deleteMessage,
  cleanupOldMessages,
};
