// Turso(libSQL)를 이용한 메시지/리액션/푸시 구독 영구 저장.
// TURSO_DATABASE_URL, TURSO_AUTH_TOKEN 환경 변수가 없으면 DB 없이(메모리만으로)
// 동작하도록 되어 있어서, 로컬 개발 시 별도 설정 없이도 서버가 돌아감.
const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

const enabled = Boolean(url);
const client = enabled ? createClient({ url, authToken }) : null;

// room 기능 추가 전에 만들어진 기존 DB에는 messages.room 컬럼이 없을 수 있어서,
// 컬럼이 정말 없을 때만 ALTER TABLE로 보강함 (매번 시도하면 이미 있을 때 에러 로그만
// 계속 쌓여서, PRAGMA로 먼저 확인함)
async function migrateRoomColumn() {
  const info = await client.execute('PRAGMA table_info(messages)');
  const hasRoom = info.rows.some((r) => r.name === 'room');
  if (!hasRoom) {
    await client.execute(`ALTER TABLE messages ADD COLUMN room TEXT NOT NULL DEFAULT 'general'`);
  }
}

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
        room TEXT NOT NULL DEFAULT 'general',
        time INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS reactions (
        message_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        client_id TEXT NOT NULL,
        PRIMARY KEY (message_id, emoji, client_id)
      )`,
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        room TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(time)`,
    ],
    'write'
  );
  await migrateRoomColumn();
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room, time)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_push_room ON push_subscriptions(room)`);
  console.log('Turso DB 연결/초기화 완료.');
}

async function insertMessage({ id, type, content, nickname, clientId, room, time }) {
  if (!enabled) return;
  await client.execute({
    sql: 'INSERT INTO messages (id, type, content, nickname, client_id, room, time) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [id, type, content, nickname, clientId, room, time],
  });
}

// 여러 메시지에 리액션 정보를 붙여서 반환 (내부 헬퍼)
async function attachReactions(messages) {
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

// 해당 방의 최근 메시지 최대 limit개를 시간순(오래된 것부터)으로 반환
async function getRecentMessages(room, limit = 50) {
  if (!enabled) return [];

  const result = await client.execute({
    sql: 'SELECT id, type, content, nickname, client_id as clientId, time FROM messages WHERE room = ? ORDER BY time DESC LIMIT ?',
    args: [room, limit],
  });
  return attachReactions(result.rows.reverse());
}

// beforeTime보다 이전(오래된) 메시지를 최대 limit개, 시간순(오래된 것부터)으로 반환.
// "이전 메시지 더 보기" 페이지네이션에 사용.
async function getMessagesBefore(room, beforeTime, limit = 50) {
  if (!enabled) return [];

  const result = await client.execute({
    sql: 'SELECT id, type, content, nickname, client_id as clientId, time FROM messages WHERE room = ? AND time < ? ORDER BY time DESC LIMIT ?',
    args: [room, beforeTime, limit],
  });
  return attachReactions(result.rows.reverse());
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

// 본인 메시지만 삭제 가능. clientId가 실제 작성자와 일치할 때만 삭제하고,
// 성공 시 그 메시지가 있던 room을 반환 (브로드캐스트 범위를 알기 위함).
async function deleteMessage(id, clientId) {
  if (!enabled) return null;

  const existing = await client.execute({
    sql: 'SELECT room, client_id as clientId FROM messages WHERE id = ?',
    args: [id],
  });
  const row = existing.rows[0];
  if (!row || row.clientId !== clientId) return null;

  await client.batch(
    [
      { sql: 'DELETE FROM reactions WHERE message_id = ?', args: [id] },
      { sql: 'DELETE FROM messages WHERE id = ?', args: [id] },
    ],
    'write'
  );
  return row.room;
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

// --- 웹 푸시 구독 저장 (백그라운드 알림용) ---

async function saveSubscription({ endpoint, clientId, room, p256dh, auth }) {
  if (!enabled) return;
  await client.execute({
    sql: `INSERT INTO push_subscriptions (endpoint, client_id, room, p256dh, auth, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET client_id = excluded.client_id, room = excluded.room,
            p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at`,
    args: [endpoint, clientId, room, p256dh, auth, Date.now()],
  });
}

async function removeSubscription(endpoint) {
  if (!enabled) return;
  await client.execute({ sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [endpoint] });
}

async function getSubscriptionsForRoom(room) {
  if (!enabled) return [];
  const result = await client.execute({
    sql: 'SELECT endpoint, client_id as clientId, p256dh, auth FROM push_subscriptions WHERE room = ?',
    args: [room],
  });
  return result.rows;
}

module.exports = {
  enabled,
  init,
  insertMessage,
  getRecentMessages,
  getMessagesBefore,
  toggleReaction,
  deleteMessage,
  cleanupOldMessages,
  saveSubscription,
  removeSubscription,
  getSubscriptionsForRoom,
};
