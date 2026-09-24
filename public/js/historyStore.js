import { DEFAULT_ROOM, HISTORY_LIMIT } from './constants.js';
import { state } from './state.js';

// 새로고침해도 대화가 이어져 보이도록 방별로 sessionStorage에 최근 메시지를 저장해 둠.
// 실패해도(저장 공간 부족 등) 보너스 기능이라 조용히 무시함.
function historyKey() {
  return `orischat-history:${state.room || DEFAULT_ROOM}`;
}

export function loadHistory() {
  try {
    return JSON.parse(sessionStorage.getItem(historyKey()) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try {
    sessionStorage.setItem(historyKey(), JSON.stringify(history));
  } catch {
    // 무시
  }
}

export function clearHistory() {
  sessionStorage.removeItem(historyKey());
}

export function saveToHistory(entry) {
  const history = loadHistory();
  history.push(entry);
  while (history.length > HISTORY_LIMIT) history.shift();
  saveHistory(history);
}

// 저장해둔 히스토리 중 해당 메시지의 payload를 고쳐서, 새로고침해도 리액션/삭제/
// 수정 상태가 유지되게 함
export function updateHistoryEntry(messageId, mutate) {
  const history = loadHistory();
  let changed = false;
  for (const entry of history) {
    if (entry.kind === 'chat' && entry.payload && entry.payload.id === messageId) {
      mutate(entry.payload);
      changed = true;
    }
  }
  if (changed) saveHistory(history);
}
