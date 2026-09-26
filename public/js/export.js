import { exportBtn } from './elements.js';
import { exportFilename, formatExportJson, formatExportText } from './exportFormat.js';
import { loadHistory } from './historyStore.js';
import { socket } from './socket.js';
import { state } from './state.js';
import { showToast } from './toast.js';

// 대화 내보내기: 서버에 저장된 방의 대화(DB가 있을 때)를 통째로, 없으면 이 브라우저에 남은
// 대화라도 텍스트/JSON 파일로 저장함.
const picker = document.createElement('div');
picker.id = 'export-picker';
picker.className = 'hidden';
picker.innerHTML = `
  <button type="button" class="theme-option" data-format="txt">📄 텍스트 (.txt)</button>
  <button type="button" class="theme-option" data-format="json">🧾 JSON (.json)</button>
  <div class="export-note">사진은 "(사진)"으로만 저장돼요</div>`;
document.body.appendChild(picker);

function requestServerExport() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 10000);
    socket.emit('export-messages', {}, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

async function collectMessages() {
  const res = await requestServerExport();
  if (res && res.available) return { messages: res.messages, truncated: res.truncated, complete: true };
  if (res && res.limited) throw new Error('limited');
  // 서버에 저장된 기록이 없으면(DB 미설정) 이 브라우저가 받아둔 대화만 내보냄
  const messages = loadHistory()
    .filter((e) => e.kind === 'chat')
    .map((e) => e.payload)
    .map((p) => ({ id: p.id, type: p.type || 'text', content: p.type === 'image' ? '' : p.content ?? p.message ?? '', nickname: p.nickname, time: p.time, replyTo: p.replyTo, edited: p.edited }));
  return { messages, truncated: false, complete: false };
}

function download(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function runExport(format) {
  let data;
  try {
    data = await collectMessages();
  } catch {
    showToast('잠시 후 다시 시도해주세요', 2500);
    return;
  }
  if (!data.messages.length) {
    showToast('내보낼 메시지가 없어요', 2500);
    return;
  }
  const input = { room: state.room, messages: data.messages, truncated: data.truncated };
  if (format === 'json') download(exportFilename(state.room, 'json'), 'application/json', formatExportJson(input));
  else download(exportFilename(state.room, 'txt'), 'text/plain', `﻿${formatExportText(input)}`);
  showToast(
    data.complete ? `메시지 ${data.messages.length}개를 저장했어요` : `저장된 기록이 없어서 이 화면에 남은 ${data.messages.length}개만 저장했어요`,
    3500
  );
}

exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const opening = picker.classList.contains('hidden');
  if (opening) {
    const rect = exportBtn.getBoundingClientRect();
    picker.style.top = `${rect.bottom + window.scrollY + 6}px`;
    picker.style.right = `${window.innerWidth - rect.right}px`;
  }
  picker.classList.toggle('hidden');
});

picker.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-format]');
  if (!btn) return;
  picker.classList.add('hidden');
  runExport(btn.dataset.format);
});

document.addEventListener('click', (e) => {
  if (!picker.classList.contains('hidden') && e.target !== exportBtn && !picker.contains(e.target)) picker.classList.add('hidden');
});
