self.addEventListener("push", function (event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}

  const options = {
    body: data.body || "New notification",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: data.tag || "tennis-notification",
    requireInteraction: false,
    data: { link: data.link || "/" },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Hudson Valley Tennis", options)
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const link = event.notification.data?.link || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if ("focus" in client) {
          client.postMessage({ type: "navigate", link });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(link);
      }
    })
  );
});
