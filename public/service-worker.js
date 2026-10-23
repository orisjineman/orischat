// OrisChat 백그라운드 푸시 알림용 Service Worker.
// 탭(심지어 브라우저 자체)이 닫혀 있어도 서버가 보낸 푸시를 받아 시스템 알림을
// 띄우는 역할만 함 — 오프라인 캐싱 등은 하지 않음(이 앱은 실시간 채팅이라
// 오프라인에서 보여줄 의미 있는 화면이 없음).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 예전 버전이 남긴 푸시 진단 로그 캐시 정리
  event.waitUntil(Promise.all([self.clients.claim(), caches.delete('orischat-debug')]));
});

self.addEventListener('push', (event) => {
  let data = { title: '새 메시지', body: '확인하려면 클릭하세요' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // JSON이 아니면 기본값 사용
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 이미 채팅창을 "보고 있는" 탭이 있으면 시스템 알림은 띄우지 않음 (실시간으로
      // 화면에 메시지가 뜨는데 알림까지 겹치면 시끄러우니까). focused만 보면 창
      // 포커스 판정이 애매한 환경에서 알림이 과하게 억제될 수 있어서, 화면에 실제로
      // 보이는 중(visible)인지도 같이 확인함 — 둘 중 하나만 참이어도 "보고 있다"로 침.
      const isBeingViewed = clientList.some((c) => c.focused || c.visibilityState === 'visible');

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
