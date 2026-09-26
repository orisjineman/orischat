// 입장(join)과 퇴장(disconnect)
const db = require('../../db');
const { CHAT_PIN, DEFAULT_ROOM, HISTORY_PAGE_SIZE, MAX } = require('../config');
const { toClientMessages } = require('../present');
const { forgetSocket } = require('../rateLimiter');
const { isNicknameTaken, users, forgetReader } = require('../state');

function cleanRoomName(name) {
  const trimmed = String(name || '').trim().slice(0, MAX.ROOM);
  return trimmed || DEFAULT_ROOM;
}

// 문자열(구버전 클라이언트)과 { nickname, clientId, pin, room } 객체 둘 다 지원
function parseJoinPayload(data) {
  return typeof data === 'string' ? { nickname: data, clientId: null, pin: '', room: '' } : data || {};
}

function register(socket, { emit }) {
  socket.on('join', (data) => {
    const { nickname, clientId, pin, room } = parseJoinPayload(data);

    if (CHAT_PIN && pin !== CHAT_PIN) {
      socket.emit('join-error', '비밀번호가 틀렸습니다.');
      return;
    }

    const cleanName = String(nickname || '').trim().slice(0, MAX.NICKNAME) || `손님${socket.id.slice(0, 4)}`;
    // clientId는 브라우저마다 고유한 값으로, 재연결되어도 "나"를 정확히 구분하기 위해 사용.
    // 서버 안에서만 쓰고, 남에게 보낼 땐 절대 그대로 내려주지 않음(emitPersonalized 참고).
    const id = String(clientId || socket.id).slice(0, MAX.CLIENT_ID);
    const roomName = cleanRoomName(room);

    // 같은 방에 다른 사람(다른 clientId)이 이미 쓰는 닉네임이면 입장 거절. 같은 clientId면
    // 재연결이거나 같은 브라우저의 다른 탭이므로 허용함.
    if (isNicknameTaken(roomName, cleanName, id, socket.id)) {
      socket.emit('join-error', '이미 사용 중인 닉네임입니다. 다른 닉네임을 써주세요.');
      return;
    }

    if (socket.data.room && socket.data.room !== roomName) {
      socket.leave(socket.data.room);
    }
    socket.join(roomName);

    users.set(socket.id, { nickname: cleanName, room: roomName, clientId: id });
    socket.data.nickname = cleanName;
    socket.data.clientId = id;
    socket.data.room = roomName;

    socket.emit('joined', { nickname: cleanName, clientId: id, room: roomName });
    socket.broadcast.to(roomName).emit('system-message', `${cleanName}님이 입장했습니다.`);
    emit.broadcastUserList(roomName);
    // 새로 들어온 사람이 room의 "다들 어디까지 읽었나" 기준에도 영향을 주므로 갱신
    emit.broadcastReadUpdate(roomName);

    if (db.enabled) {
      db.getRecentMessages(roomName, HISTORY_PAGE_SIZE)
        .then((history) => socket.emit('history', toClientMessages(history, roomName, id)))
        .catch((err) => console.error('히스토리 조회 오류:', err));
    }
  });

  socket.on('disconnect', () => {
    forgetSocket(socket.id);

    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      socket.broadcast.to(user.room).emit('system-message', `${user.nickname}님이 퇴장했습니다.`);
      emit.broadcastUserList(user.room);
      // 나간 사람 기준으로 "다들 어디까지 읽었나"가 바뀔 수 있으니 다시 계산
      forgetReader(user.room, socket.data.clientId);
      emit.broadcastReadUpdate(user.room);
    }
  });
}

module.exports = { register };
