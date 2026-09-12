// Turso(libSQL)를 이용한 메시지/리액션 영구 저장.
// TURSO_DATABASE_URL, TURSO_AUTH_TOKEN 환경 변수가 없으면 DB 없이(메모리만으로)
// 동작하도록 되어 있어서, 로컬 개발 시 별도 설정 없이도 서버가 돌아감.
const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

const enabled = Boolean(url);
const client = enabled ? createClient({ url, authToken }) : null;

async function init() {
  if (!enabled) {
    console.log('TURSO_DATABASE_URL이 없어서 메시지가 저장되지 않습니다 (메모리에만 유지).');
    return;
  }
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        nickname TEXT NOT NULL,
        client_id TEXT NOT NULL,
        time INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS reactions (
        message_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        client_id TEXT NOT NULL,
        PRIMARY KEY (message_id, emoji, client_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(time)`,
    ],
    'write'
  );
  console.log('Turso DB 연결/초기화 완료.');
}

async function insertMessage({ id, type, content, nickname, clientId, time }) {
  if (!enabled) return;
  await client.execute({
    sql: 'INSERT INTO messages (id, type, content, nickname, client_id, time) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, type, content, nickname, clientId, time],
  });
}

// 최근 메시지 최대 limit개를 시간순(오래된 것부터)으로 반환하고, 각 메시지에
// 리액션 정보를 붙여서 돌려줌.
async function getRecentMessages(limit = 200) {
  if (!enabled) return [];

  const result = await client.execute({
    sql: 'SELECT id, type, content, nickname, client_id as clientId, time FROM messages ORDER BY time DESC LIMIT ?',
    args: [limit],
  });
  const messages = result.rows.reverse();
  if (messages.length === 0) return [];

  const ids = messages.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const reactionRows = await client.execute({
    sql: `SELECT message_id as messageId, emoji, client_id as clientId FROM reactions WHERE message_id IN (${placeholders})`,
    args: ids,
  });

  const reactionsByMessage = new Map();
  for (const row of reactionRows.rows) {
    if (!reactionsByMessage.has(row.messageId)) reactionsByMessage.set(row.messageId, {});
    const byEmoji = reactionsByMessage.get(row.messageId);
    if (!byEmoji[row.emoji]) byEmoji[row.emoji] = [];
    byEmoji[row.emoji].push(row.clientId);
  }

  return messages.map((m) => ({ ...m, reactions: reactionsByMessage.get(m.id) || {} }));
}

// 이미 눌렀던 반응이면 취소(토글), 아니면 추가. 최신 반응 요약을 반환함.
async function toggleReaction(messageId, emoji, clientId) {
  if (!enabled) return {};

  const existing = await client.execute({
    sql: 'SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ? AND client_id = ?',
    args: [messageId, emoji, clientId],
  });

  if (existing.rows.length > 0) {
    await client.execute({
      sql: 'DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND client_id = ?',
      args: [messageId, emoji, clientId],
    });
  } else {
    await client.execute({
      sql: 'INSERT INTO reactions (message_id, emoji, client_id) VALUES (?, ?, ?)',
      args: [messageId, emoji, clientId],
    });
  }

  const rows = await client.execute({
    sql: 'SELECT emoji, client_id as clientId FROM reactions WHERE message_id = ?',
    args: [messageId],
  });

  const summary = {};
  for (const row of rows.rows) {
    if (!summary[row.emoji]) summary[row.emoji] = [];
    summary[row.emoji].push(row.clientId);
  }
  return summary;
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7일

// 7일 지난 메시지와 그에 달린 리액션을 DB에서 완전히 삭제
async function cleanupOldMessages() {
  if (!enabled) return;

  const cutoff = Date.now() - RETENTION_MS;
  const old = await client.execute({
    sql: 'SELECT id FROM messages WHERE time < ?',
    args: [cutoff],
  });
  const ids = old.rows.map((r) => r.id);
  if (ids.length === 0) return;

  const placeholders = ids.map(() => '?').join(',');
  await client.batch(
    [
      { sql: `DELETE FROM reactions WHERE message_id IN (${placeholders})`, args: ids },
      { sql: `DELETE FROM messages WHERE id IN (${placeholders})`, args: ids },
    ],
    'write'
  );
  console.log(`오래된 메시지 ${ids.length}개(7일 경과) 삭제 완료.`);
}

module.exports = { enabled, init, insertMessage, getRecentMessages, toggleReaction, cleanupOldMessages };
