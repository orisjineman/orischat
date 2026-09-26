import { DEFAULT_ROOM } from './constants.js';

// 방마다 "여기까지 봤다"는 시각. 탭을 닫았다 다시 와도 남아 있어야 해서 localStorage에 둠.
const key = (room) => `orischat-lastseen-${room || DEFAULT_ROOM}`;

export function getLastSeen(room) {
  try {
    return Number(localStorage.getItem(key(room))) || 0;
  } catch {
    return 0;
  }
}

export function setLastSeen(room, time) {
  try {
    if (time > getLastSeen(room)) localStorage.setItem(key(room), String(time));
  } catch {
    // 저장 실패는 무시 (필수 기능 아님)
  }
}
