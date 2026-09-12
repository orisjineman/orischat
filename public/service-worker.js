// OrisChat 백그라운드 푸시 알림용 Service Worker.
// 탭(심지어 브라우저 자체)이 닫혀 있어도 서버가 보낸 푸시를 받아 시스템 알림을
// 띄우는 역할만 함 — 오프라인 캐싱 등은 하지 않음(이 앱은 실시간 채팅이라
// 오프라인에서 보여줄 의미 있는 화면이 없음).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 진단용 로그: 캐시 스토리지에 최근 push 이벤트를 몇 개 남겨서, 페이지 쪽에서
// caches.open('orischat-debug') 로 읽어볼 수 있게 함 (문제 생겼을 때 원인 파악용).
async function logDebug(entry) {
  try {
    const cache = await caches.open('orischat-debug');
    const existing = await cache.match('debug-log');
    let log = existing ? await existing.json() : [];
    log.push({ time: new Date().toISOString(), ...entry });
    if (log.length > 20) log = log.slice(-20);
    await cache.put('debug-log', new Response(JSON.stringify(log), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    // 진단 로그 실패는 무시 (알림 자체엔 영향 없음)
  }
}

self.addEventListener('push', (event) => {
  let data = { title: '새 메시지', body: '확인하려면 클릭하세요' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // JSON이 아니면 기본값 사용
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      // 이미 채팅창을 "보고 있는" 탭이 있으면 시스템 알림은 띄우지 않음 (실시간으로
      // 화면에 메시지가 뜨는데 알림까지 겹치면 시끄러우니까). focused만 보면 창
      // 포커스 판정이 애매한 환경에서 알림이 과하게 억제될 수 있어서, 화면에 실제로
      // 보이는 중(visible)인지도 같이 확인함 — 둘 중 하나만 참이어도 "보고 있다"로 침.
      const isBeingViewed = clientList.some((c) => c.focused || c.visibilityState === 'visible');

      await logDebug({
        title: data.title,
        clientCount: clientList.length,
        clients: clientList.map((c) => ({ focused: c.focused, visibilityState: c.visibilityState })),
        isBeingViewed,
        shown: !isBeingViewed,
      });

      if (isBeingViewed) return;

      return self.registration.showNotification(data.title, {
        body: data.body,
        tag: 'orischat-message',
        renotify: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const c of clientList) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
