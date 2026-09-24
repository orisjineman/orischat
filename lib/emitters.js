const { usersInRoom, getLastRead } = require('./state');

// io에 묶인 "방 전체에 보내기" 헬퍼 모음
function createEmitters(io) {
  // room 안의 모든 소켓에게 "각자 다른 내용"을 담아 개별적으로 전송함. 예를 들어
  // 메시지가 "내가 쓴 건지" 여부는 보는 사람마다 다름. 이렇게 서버가 각자에게 맞는
  // 값만 계산해서 보내면, 다른 사람의 영구 식별자(clientId, localStorage에 저장돼서
  // 닉네임을 바꿔도 안 변함)를 클라이언트끼리 서로 알 필요가 없어져서 추적당할
  // 걱정이 줄어듦.
  function emitPersonalized(room, event, factory) {
    for (const [, s] of io.sockets.sockets) {
      if (s.data.room !== room) continue;
      s.emit(event, factory(s));
    }
  }

  function broadcastUserList(room) {
    io.to(room).emit('user-list', usersInRoom(room));
  }

  // 방에 있는 각 사람에게 "나를 제외한 나머지가 최소 어디까지 읽었는지" 시각을
  // 계산해서 보내줌 — 내가 보낸 메시지의 시각이 이 값보다 작거나 같으면
  // "방에 있는 모두가 읽었다"는 뜻이라 클라이언트에서 "읽음"으로 표시함.
  function broadcastReadUpdate(room) {
    emitPersonalized(room, 'read-update', (viewer) => {
      let min = Infinity;
      for (const [, socket] of io.sockets.sockets) {
        if (socket.data.room !== room || socket.data.clientId === viewer.data.clientId) continue;
        min = Math.min(min, getLastRead(room, socket.data.clientId));
      }
      return { minReadTime: Number.isFinite(min) ? min : 0 };
    });
  }

  return { emitPersonalized, broadcastUserList, broadcastReadUpdate };
}

module.exports = { createEmitters };
