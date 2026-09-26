// 서버가 메모리에 들고 있는 실시간 상태: 접속자, 메시지 작성자 캐시, 읽음 위치.
const { MESSAGE_META_LIMIT } = require('./config');

// 현재 접속 중인 사용자 목록 (socket.id -> { nickname, room })
const users = new Map();

function usersInRoom(room) {
  return Array.from(users.values())
    .filter((u) => u.room === room)
    .map((u) => u.nickname);
}

// 같은 방에서 다른 사람(clientId가 다른)이 이미 이 닉네임(대소문자 무시)을 쓰고 있는지
function isNicknameTaken(room, nickname, clientId, exceptSocketId) {
  const wanted = nickname.toLowerCase();
  for (const [socketId, u] of users.entries()) {
    if (socketId === exceptSocketId || u.room !== room) continue;
    if (u.nickname.toLowerCase() === wanted && u.clientId !== clientId) return true;
  }
  return false;
}

// 방별 접속자 수 (room -> count)
function activeUserCounts() {
  const counts = new Map();
  for (const u of users.values()) {
    counts.set(u.room, (counts.get(u.room) || 0) + 1);
  }
  return counts;
}

// 메시지 안에서 "@닉네임" 형태로 현재 방에 있는 사람을 부르면 그 닉네임들을 반환.
// 정규식 \b는 한글 경계를 못 잡아서, 단순 포함 여부로 확인함.
function detectMentions(content, room) {
  const names = Array.from(new Set(usersInRoom(room)));
  return names.filter((name) => content.includes(`@${name}`));
}

// 최근 메시지의 작성자/방 정보 (messageId -> { clientId, room }).
// DB(TURSO)가 없을 때는 삭제 권한을 확인할 유일한 수단이고, DB가 있을 때도
// 매번 조회하지 않고 빠르게 확인하는 캐시 역할을 함. 무한히 커지지 않도록 오래된
// 항목은 버림.
const messageMeta = new Map();

function rememberMessage(id, clientId, room, snapshot = {}) {
  messageMeta.set(id, { clientId, room, ...snapshot });
  if (messageMeta.size > MESSAGE_META_LIMIT) {
    messageMeta.delete(messageMeta.keys().next().value);
  }
}

function getMessageMeta(id) {
  return messageMeta.get(id);
}

function forgetMessage(id) {
  messageMeta.delete(id);
}

// 읽음 표시: room -> Map<clientId, lastReadTime>. 재시작하면 초기화되지만,
// "현재 접속 중인 사람들이 어디까지 읽었는지"만 다루므로 굳이 DB에 남길
// 필요는 없음(재연결하면 다시 join 시점 기준으로 채워짐).
const lastRead = new Map();

function getLastRead(room, clientId) {
  const roomMap = lastRead.get(room);
  return (roomMap && roomMap.get(clientId)) || 0;
}

// 이미 그만큼 이상 읽음 처리돼 있으면 false, 새로 갱신했으면 true
function setLastRead(room, clientId, time) {
  if (getLastRead(room, clientId) >= time) return false;
  if (!lastRead.has(room)) lastRead.set(room, new Map());
  lastRead.get(room).set(clientId, time);
  return true;
}

function forgetReader(room, clientId) {
  const roomMap = lastRead.get(room);
  if (roomMap) roomMap.delete(clientId);
}

module.exports = {
  users,
  usersInRoom,
  isNicknameTaken,
  activeUserCounts,
  detectMentions,
  rememberMessage,
  getMessageMeta,
  forgetMessage,
  getLastRead,
  setLastRead,
  forgetReader,
};
