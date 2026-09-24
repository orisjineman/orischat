const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const { PORT, CLEANUP_INTERVAL_MS, PUBLIC_DIR } = require('./lib/config');
const { createEmitters } = require('./lib/emitters');
const { registerHandlers } = require('./lib/handlers');
const { apiRouter } = require('./lib/routes');
const { stickersRouter } = require('./lib/stickers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 스티커 라우터는 express.static보다 먼저 등록해야 우선 처리됨.
app.use(apiRouter);
app.use(stickersRouter);
app.use(express.static(PUBLIC_DIR));

const ctx = { io, emit: createEmitters(io) };
io.on('connection', (socket) => registerHandlers(socket, ctx));

function cleanupOldMessages() {
  db.cleanupOldMessages().catch((err) => console.error('오래된 메시지 정리 오류:', err));
}

// port를 직접 넘기면(테스트에서 0을 넘겨 임의의 빈 포트를 쓰는 등) 그 값을,
// 아니면 PORT 환경 변수(기본값 3000)를 사용함.
function start(port = PORT) {
  return db
    .init()
    .catch((err) => console.error('DB 초기화 오류:', err))
    .then(() => {
      // 주의: .finally()의 콜백 반환값은 체인 결과에 반영되지 않으므로(원래
      // 값/에러가 그대로 전달됨) 포트 번호를 돌려주려면 .then()을 써야 함.
      if (db.enabled) {
        cleanupOldMessages();
        // unref: 이 타이머 때문에 프로세스(테스트 등)가 종료되지 못하는 일이 없도록 함
        setInterval(cleanupOldMessages, CLEANUP_INTERVAL_MS).unref();
      }

      return new Promise((resolve) => {
        server.listen(port, () => {
          console.log(`채팅 서버가 http://localhost:${server.address().port} 에서 실행 중입니다.`);
          resolve(server.address().port);
        });
      });
    });
}

// 테스트에서 require('./server')로 불러와 직접 listen을 제어할 수 있도록,
// 이 파일이 커맨드로 바로 실행됐을 때만 자동으로 서버를 띄움.
if (require.main === module) {
  start();
}

module.exports = { app, server, io, start };
