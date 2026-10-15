function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function apiUrl(path: string) {
  return `${BASE}/api${path}`;
}

export async function isPushSupported(): Promise<boolean> {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(`${BASE}/service-worker.js`);
  } catch {
    return null;
  }
}

export async function subscribeToPush(): Promise<{ success: boolean; error?: string }> {
  try {
    const supported = await isPushSupported();
    if (!supported) return { success: false, error: "not-supported" };

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { success: false, error: "denied" };

    const registration = await registerServiceWorker();
    if (!registration) return { success: false, error: "sw-failed" };

    // Fetch vapid key from server
    const statusRes = await fetch(apiUrl("/notifications/status"), { credentials: "include" });
    const statusData = await statusRes.json();
    const vapidPublicKey = statusData.vapidPublicKey;
    if (!vapidPublicKey) return { success: false, error: "no-vapid-key" };

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      });
    }

    const subJson = subscription.toJSON() as { endpoint: string; keys?: { auth: string; p256dh: string } };
    const saveRes = await fetch(apiUrl("/notifications/subscribe"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
      }),
    });

    if (!saveRes.ok) return { success: false, error: "save-failed" };
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

export async function unsubscribeFromPush(): Promise<{ success: boolean }> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return { success: false };
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { success: false };

    await fetch(apiUrl("/notifications/unsubscribe"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function getPushStatus(): Promise<{
  browserPermission: NotificationPermission;
  subscribed: boolean;
  supported: boolean;
}> {
  const supported = await isPushSupported();
  if (!supported) return { supported: false, browserPermission: "denied", subscribed: false };

  const browserPermission = await getNotificationPermission();
  const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
  const subscription = registration ? await registration.pushManager.getSubscription().catch(() => null) : null;

  return { supported, browserPermission, subscribed: !!subscription };
}
