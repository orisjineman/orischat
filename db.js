// Turso(libSQL)를 이용한 메시지/리액션/푸시 구독/프로필 사진 영구 저장.
// 실제 구현은 lib/db/ 아래 테이블별 모듈에 있고, 여기서는 한 곳으로 모아서 내보냄.
// TURSO_DATABASE_URL이 없으면 enabled가 false이고 모든 함수가 "아무것도 안 함" 값을
// 돌려줌 (조회는 빈 값, 쓰기는 무시).
const { enabled } = require('./lib/db/client');
const { init } = require('./lib/db/schema');

module.exports = {
  enabled,
  init,
  ...require('./lib/db/messages'),
  toggleReaction: require('./lib/db/reactions').toggleReaction,
  ...require('./lib/db/subscriptions'),
  ...require('./lib/db/avatars'),
  ...require('./lib/db/pins'),
};
