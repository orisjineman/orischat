const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

module.exports = {
  PORT: process.env.PORT || 3000,
  // 설정해두면 입장 시 이 비밀번호를 맞춰야 함 (안 정하면 누구나 바로 입장 가능)
  CHAT_PIN: process.env.CHAT_PIN || '',

  DEFAULT_ROOM: 'general',
  HISTORY_PAGE_SIZE: 50,
  SEARCH_RESULT_LIMIT: 50,
  KNOWN_ROOMS_LIMIT: 50,

  // 입력 길이 상한 (서버에서 한 번 더 강제함)
  MAX: {
    NICKNAME: 20,
    ROOM: 30,
    CLIENT_ID: 100,
    MESSAGE: 500,
    SEARCH_QUERY: 100,
    REPLY_ID: 100,
    REPLY_PREVIEW: 120,
  },

  // base64로 인코딩된 이미지 문자열의 최대 길이 (대략 원본 이미지 500KB 정도에 해당).
  // DB(Turso 무료 티어) 용량을 지키기 위한 상한 — 클라이언트도 미리 리사이즈해서
  // 보내지만, 서버에서도 한 번 더 강제함.
  IMAGE_MAX_LENGTH: 700_000,
  // 프로필 사진은 훨씬 작게(정사각형 썸네일) 보내므로 상한도 더 낮게 둠
  AVATAR_MAX_LENGTH: 250_000,

  // 삭제 권한 확인용 캐시(messageId -> 작성자/방)가 무한히 커지지 않게 하는 상한
  MESSAGE_META_LIMIT: 1000,

  // GIF 검색(GIPHY). 키가 없으면 GIF 기능이 꺼짐 — 브라우저에는 키를 노출하지 않고
  // 서버가 대신 검색해서 결과만 내려줌.
  GIPHY_API_KEY: process.env.GIPHY_API_KEY || '',
  GIPHY_API_BASE: process.env.GIPHY_API_BASE || 'https://api.giphy.com/v1/gifs',
  GIF_URL_MAX_LENGTH: 300,

  // "검색 결과로 이동"할 때 한 번에 불러올 수 있는 최대 메시지 수
  JUMP_LOAD_LIMIT: 500,

  CLEANUP_INTERVAL_MS: 24 * 60 * 60 * 1000, // 하루에 한 번

  // public/stickers 폴더에 이미지를 넣으면 자동으로 스티커로 인식됨 (서버 재시작 불필요)
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  STICKERS_DIR: path.join(ROOT_DIR, 'public', 'stickers'),
  STICKERS_CACHE_DIR: path.join(ROOT_DIR, '.stickers-cache'),
  STICKER_EXTENSIONS: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']),
  // 스티커 원본이 이 크기(긴 쪽 기준, px)보다 크면 줄여서 보내고, 작으면 원본 그대로 보냄
  STICKER_MAX_DIMENSION: 320,
};
