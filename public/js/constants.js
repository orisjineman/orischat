export const IMAGE_MAX_LENGTH = 700_000; // 서버와 동일한 상한 (대략 500KB 원본에 해당)
export const AVATAR_MAX_LENGTH = 250_000; // 서버와 동일한 프로필 사진 상한

export const DEFAULT_ROOM = 'general';
export const HISTORY_PAGE_SIZE = 50;

// sessionStorage는 "새로고침하면 유지되고, 탭을 닫으면 사라지는" 저장소라서
// 딱 원하는 동작(새로고침 → 재입장 화면 안 보고 이어가기 / 탭 닫음 → 초기화)에 맞음.
export const NICKNAME_KEY = 'orischat-nickname';
export const PIN_KEY = 'orischat-pin';
export const ROOM_KEY = 'orischat-room';
export const CLIENT_ID_KEY = 'orischat-client-id';
export const THEME_KEY = 'orischat-theme';
export const HISTORY_LIMIT = 200;

// 대화를 위로 스크롤해서 지난 메시지를 읽던 중이면, 새 메시지가 와도 화면을
// 억지로 맨 아래로 당기지 않음 — 이미 맨 아래 근처에 있을 때만 자동으로 따라 내려감.
export const NEAR_BOTTOM_THRESHOLD = 80;
