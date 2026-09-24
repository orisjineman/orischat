import { CLIENT_ID_KEY, NICKNAME_KEY, PIN_KEY, ROOM_KEY } from './constants.js';

// 브라우저마다 고유한 ID. 재연결(화면 꺼짐/네트워크 전환 등)되어도 "내 메시지"를
// 정확히 구분하기 위해 서버에만 알려주는 값 (다른 사용자에게는 절대 전달되지 않음).
function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}
export const myClientId = getClientId();

export function roomFromUrl() {
  const params = new URLSearchParams(location.search);
  return (params.get('room') || '').trim().slice(0, 30) || null;
}

// 여러 모듈이 함께 읽고 바꾸는 값들 (ES 모듈의 let export는 다른 모듈에서 재할당할
// 수 없어서 객체 하나에 모아둠)
export const state = {
  nickname: sessionStorage.getItem(NICKNAME_KEY) || '',
  pin: sessionStorage.getItem(PIN_KEY) || '',
  room: roomFromUrl() || sessionStorage.getItem(ROOM_KEY) || '',
  hasJoined: false,
  oldestMessageTime: null, // "이전 메시지 더 보기" 기준 시각
  latestMessageTime: 0, // 읽음 표시용 — 지금까지 화면에 그려진 메시지 중 가장 최신 시각
  roomMinReadTime: 0, // 나를 제외한 방 안 모두가 최소 어디까지 읽었는지
  pushPublicKey: null,
  pushSubscribed: false,
  roomUsers: [], // 방에 있는 사람들 닉네임 — @멘션 하이라이트를 판단할 때 씀
  pendingReplyTo: null, // 답장 중인 메시지 { id, nickname, preview }
};

// 닉네임 -> 프로필 사진 버전(updatedAt). 캐시 무효화(cache-busting)용 —
// 사진이 바뀌면 버전도 바뀌어서 브라우저가 새로 받아오게 됨.
export const avatarVersions = new Map();
