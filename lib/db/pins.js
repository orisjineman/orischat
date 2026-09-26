// 방별 고정 메시지. 원본 메시지가 지워지거나 7일이 지나도 안내가 남도록 미리보기를
// 함께 저장함 (고정된 메시지는 자동 정리 대상에서도 빠짐 — messages.cleanupOldMessages 참고).
const { query, run, whenEnabled } = require('./client');

const COLUMNS = 'message_id as id, type, preview, nickname, time, pinned_at as pinnedAt';

// 최근에 고정한 것부터
const listPins = whenEnabled(
  () => [],
  (room) => query(`SELECT ${COLUMNS} FROM pins WHERE room = ? ORDER BY pinned_at DESC`, [room])
);

// 'ok' | 'exists'(이미 고정됨) | 'full'(방마다 개수 상한)
const addPin = whenEnabled(
  () => 'ok',
  async (room, { id, type, preview, nickname, time, pinnedAt }, maxPins) => {
    const [dup] = await query('SELECT 1 as x FROM pins WHERE message_id = ?', [id]);
    if (dup) return 'exists';
    const [{ n }] = await query('SELECT COUNT(*) as n FROM pins WHERE room = ?', [room]);
    if (Number(n) >= maxPins) return 'full';
    await run(
      'INSERT INTO pins (message_id, room, type, preview, nickname, time, pinned_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, room, type, preview, nickname, time, pinnedAt]
    );
    return 'ok';
  }
);

// 실제로 지웠으면 true
const removePin = whenEnabled(
  () => false,
  async (room, id) => {
    const [row] = await query('SELECT 1 as x FROM pins WHERE message_id = ? AND room = ?', [id, room]);
    if (!row) return false;
    await run('DELETE FROM pins WHERE message_id = ?', [id]);
    return true;
  }
);

// 메시지가 수정되면 고정 미리보기도 맞춰줌. 고정된 메시지였으면 true
const updatePinPreview = whenEnabled(
  () => false,
  async (id, preview) => {
    const [row] = await query('SELECT room FROM pins WHERE message_id = ?', [id]);
    if (!row) return false;
    await run('UPDATE pins SET preview = ? WHERE message_id = ?', [preview, id]);
    return true;
  }
);

module.exports = { listPins, addPin, removePin, updatePinPreview };
