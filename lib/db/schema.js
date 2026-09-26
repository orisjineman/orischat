const { enabled, query, run, transaction } = require('./client');

// 기존에 만들어진 DB에 새 컬럼이 없을 수 있어서, 정말 없을 때만 ALTER TABLE로
// 보강함 (매번 시도하면 이미 있을 때 에러 로그만 계속 쌓여서, PRAGMA로 먼저 확인함)
async function ensureColumn(table, column, definition) {
  const info = await query(`PRAGMA table_info(${table})`);
  const hasColumn = info.some((r) => r.name === column);
  if (!hasColumn) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function init() {
  if (!enabled) {
    console.log('TURSO_DATABASE_URL이 없어서 메시지가 저장되지 않습니다 (메모리에만 유지).');
    return;
  }
  await transaction(
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
      `CREATE TABLE IF NOT EXISTS avatars (
        nickname TEXT PRIMARY KEY,
        image TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS pins (
        message_id TEXT PRIMARY KEY,
        room TEXT NOT NULL,
        type TEXT NOT NULL,
        preview TEXT NOT NULL,
        nickname TEXT NOT NULL,
        time INTEGER NOT NULL,
        pinned_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(time)`,
    ].map((sql) => ({ sql, args: [] }))
  );
  await ensureColumn('messages', 'room', `TEXT NOT NULL DEFAULT 'general'`);
  await ensureColumn('messages', 'reply_to', 'TEXT');
  await ensureColumn('messages', 'edited_at', 'INTEGER');
  await run(`CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room, time)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_pins_room ON pins(room)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_push_room ON push_subscriptions(room)`);
  console.log('Turso DB 연결/초기화 완료.');
}

module.exports = { init };
