const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// 현재 접속 중인 사용자 목록 (socket.id -> nickname)
const users = new Map();

function broadcastUserList() {
  io.emit('user-list', Array.from(users.values()));
}

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    // 문자열(구버전 클라이언트)과 { nickname, clientId } 객체 둘 다 지원
    const { nickname, clientId } = typeof data === 'string' ? { nickname: data, clientId: null } : (data || {});
    const cleanName = String(nickname || '').trim().slice(0, 20) || `손님${socket.id.slice(0, 4)}`;
    // clientId는 브라우저마다 고유한 값으로, 재연결되어도 "나"를 정확히 구분하기 위해 사용
    const id = String(clientId || socket.id).slice(0, 100);

    users.set(socket.id, cleanName);
    socket.data.nickname = cleanName;
    socket.data.clientId = id;

    socket.emit('joined', { nickname: cleanName, clientId: id });
    socket.broadcast.emit('system-message', `${cleanName}님이 입장했습니다.`);
    broadcastUserList();
  });

  socket.on('chat-message', (text) => {
    const message = String(text || '').trim().slice(0, 500);
    if (!message) return;
    const nickname = socket.data.nickname || '알수없음';
    io.emit('chat-message', {
      nickname,
      message,
      time: Date.now(),
      clientId: socket.data.clientId,
    });
  });

  socket.on('typing', (isTyping) => {
    const nickname = socket.data.nickname;
    if (!nickname) return;
    socket.broadcast.emit('typing', { nickname, isTyping: !!isTyping });
  });

  socket.on('disconnect', () => {
    const nickname = users.get(socket.id);
    if (nickname) {
      users.delete(socket.id);
      socket.broadcast.emit('system-message', `${nickname}님이 퇴장했습니다.`);
      broadcastUserList();
    }
  });
});

server.listen(PORT, () => {
  console.log(`채팅 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
