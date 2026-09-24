// 백그라운드 푸시 알림 구독/해제 (탭이 닫혀있어도 알림 받기)
const push = require('../../push');

function register(socket) {
  socket.on('push-subscribe', async (subscription) => {
    const { clientId, room } = socket.data;
    if (!clientId || !room || !subscription || !subscription.endpoint) return;
    try {
      await push.subscribe({ endpoint: subscription.endpoint, clientId, room, keys: subscription.keys });
    } catch (err) {
      console.error('푸시 구독 저장 오류:', err);
    }
  });

  socket.on('push-unsubscribe', async ({ endpoint } = {}) => {
    try {
      await push.unsubscribe(endpoint);
    } catch (err) {
      console.error('푸시 구독 해제 오류:', err);
    }
  });
}

module.exports = { register };
