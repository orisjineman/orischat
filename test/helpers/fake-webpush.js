// push.js가 쓰는 web-push 모듈을 가짜로 바꿔치기함 (실제 푸시 서버로 요청이 나가지 않게).
// push.js를 require하기 "전에" 호출해야 함. require.cache 주입 방식이라 Node 버전과 무관하게 동작함.
function installFakeWebPush() {
  const calls = { vapid: [], sent: [] };
  const failures = new Map(); // endpoint -> 던질 에러

  const fake = {
    setVapidDetails: (...args) => calls.vapid.push(args),
    sendNotification: async (subscription, payload) => {
      calls.sent.push({ subscription, payload: JSON.parse(payload) });
      const failure = failures.get(subscription.endpoint);
      if (failure) throw failure;
    },
  };

  const id = require.resolve('web-push');
  require.cache[id] = { id, filename: id, loaded: true, exports: fake, children: [], paths: [] };

  return {
    calls,
    failWith(endpoint, error) {
      failures.set(endpoint, error);
    },
    reset() {
      calls.sent.length = 0;
      failures.clear();
    },
    sentEndpoints() {
      return calls.sent.map((s) => s.subscription.endpoint).sort();
    },
  };
}

const httpError = (statusCode, message = `HTTP ${statusCode}`) => Object.assign(new Error(message), { statusCode });

module.exports = { installFakeWebPush, httpError };
