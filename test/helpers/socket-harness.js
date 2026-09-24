// 서버 통합 테스트들이 같이 쓰는 소켓 클라이언트 헬퍼. (test 폴더 안이라 node --test가
// 이 파일도 실행하지만, 테스트가 없어서 아무 일도 하지 않고 통과함)
const { io: ioClient } = require('socket.io-client');

let baseUrl;

function setBaseUrl(url) {
  baseUrl = url;
}

function getBaseUrl() {
  return baseUrl;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connectClient() {
  return ioClient(baseUrl, { forceNew: true, reconnection: false, transports: ['websocket'] });
}

// event가 여러 번 올 수 있을 때, predicate를 만족하는 첫 번째 것만 기다림
function waitFor(socket, event, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`"${event}" 이벤트를 ${timeoutMs}ms 안에 받지 못함`));
    }, timeoutMs);

    function onEvent(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    }

    socket.on(event, onEvent);
  });
}

// 일정 시간 동안 predicate를 만족하는 event가 오지 않는지 확인 (오면 그 payload를 돌려줌)
async function collectDuring(socket, event, predicate = () => true, ms = 200) {
  const received = [];
  const onEvent = (payload) => {
    if (predicate(payload)) received.push(payload);
  };
  socket.on(event, onEvent);
  await sleep(ms);
  socket.off(event, onEvent);
  return received;
}

function waitForConnect(socket) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve) => socket.once('connect', resolve));
}

// close()만 부르고 완전히 끝나길 안 기다리면, 다음 테스트가 새 소켓을 여는
// 시점과 엔진 레벨에서 겹쳐서 가끔 패킷이 씹히는 것으로 보임(디버그 로그로
// 확인함). disconnect가 실제로 될 때까지 기다린 뒤 다음 테스트로 넘어가게 함.
function closeClient(socket) {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve();
    const done = () => resolve();
    socket.once('disconnect', done);
    socket.close();
    setTimeout(done, 300); // disconnect 이벤트가 안 오는 극단적 케이스를 위한 안전장치
  });
}

// 소켓이 실제로 연결되기 전에 emit하면(특히 websocket 전용 트랜스포트에서) 가끔
// 씹히는 경우가 있어서, connect를 명시적으로 기다린 뒤에 join을 보냄.
async function join(socket, { nickname, room, clientId, pin }) {
  await waitForConnect(socket);
  const data = { nickname, room, clientId: clientId || nickname };
  if (pin !== undefined) data.pin = pin;
  socket.emit('join', data);
  return waitFor(socket, 'joined');
}

// 여러 클라이언트를 만들어 각자 입장시키고, 끝나면 전부 정리하는 테스트 실행기.
// users: [{ nickname, room, clientId? }, ...] → fn(sockets 배열) 에 넘겨줌
async function withClients(users, fn) {
  const sockets = users.map(() => connectClient());
  try {
    for (let i = 0; i < users.length; i++) await join(sockets[i], users[i]);
    return await fn(sockets);
  } finally {
    await Promise.all(sockets.map(closeClient));
  }
}

module.exports = {
  setBaseUrl,
  getBaseUrl,
  sleep,
  connectClient,
  waitFor,
  collectDuring,
  waitForConnect,
  closeClient,
  join,
  withClients,
};
