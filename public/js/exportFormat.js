// 대화 내보내기 파일 내용 만들기 (화면/네트워크와 무관한 순수 함수라서 따로 뺌).
// 사진 본문(base64)은 너무 커서 넣지 않고 "(사진)"으로만 표시함.

const kindLabel = (m) => {
  if (m.type === 'sticker') return '(스티커)';
  if (m.type === 'image') return '(사진)';
  if (m.type === 'gif') return `(GIF) ${m.content}`;
  return m.content;
};

const fmtDay = (ts) => new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function formatExportText({ room, messages, exportedAt = Date.now(), truncated = false }) {
  const lines = [
    `OrisChat 대화 기록 - 방: ${room || 'general'}`,
    `내보낸 시각: ${new Date(exportedAt).toLocaleString('ko-KR')}`,
    `메시지 ${messages.length}개${truncated ? ' (오래된 메시지 일부는 포함되지 않았어요)' : ''}`,
    '',
  ];
  let lastDay = null;
  for (const m of messages) {
    if (dayKey(m.time) !== lastDay) {
      if (lastDay !== null) lines.push(''); // 헤더 다음 빈 줄은 이미 있음
      lastDay = dayKey(m.time);
      lines.push(`── ${fmtDay(m.time)} ──`);
    }
    if (m.replyTo) lines.push(`    ↳ ${m.replyTo.nickname}에게 답장: ${m.replyTo.preview}`);
    lines.push(`[${fmtTime(m.time)}] ${m.nickname}: ${kindLabel(m)}${m.edited ? ' (수정됨)' : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export function formatExportJson({ room, messages, exportedAt = Date.now(), truncated = false }) {
  return JSON.stringify(
    {
      room: room || 'general',
      exportedAt: new Date(exportedAt).toISOString(),
      count: messages.length,
      truncated,
      messages: messages.map((m) => ({
        id: m.id,
        time: m.time,
        date: new Date(m.time).toISOString(),
        nickname: m.nickname,
        type: m.type || 'text',
        content: m.type === 'image' ? null : m.content,
        replyTo: m.replyTo || null,
        edited: Boolean(m.edited),
      })),
    },
    null,
    2
  );
}

export function exportFilename(room, ext, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  const safeRoom = String(room || 'general').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  return `orischat-${safeRoom}-${stamp}.${ext}`;
}
