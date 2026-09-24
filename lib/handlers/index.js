// 소켓 하나가 연결됐을 때 이벤트 핸들러들을 등록함. ctx = { io, emit }
const handlers = [
  require('./session'),
  require('./chat'),
  require('./reactions'),
  require('./messageActions'),
  require('./history'),
  require('./pushSubscription'),
  require('./avatar'),
  require('./presence'),
];

function registerHandlers(socket, ctx) {
  for (const handler of handlers) handler.register(socket, ctx);
}

module.exports = { registerHandlers };
