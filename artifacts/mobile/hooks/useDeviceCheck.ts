// DeviceCheck device bans (Wave 2, Session G; acceptance 38). Once per app
// launch for each signed-in account, a fresh DeviceCheck token goes to Ball
// Boi, which asks Apple whether a banned account used this iPhone. If so,
// the account is banned too: the answer is a 403 "account_banned", which
// lib/api.ts turns into the account-blocked screen. A failed check never
// stops anyone using Ball Boi.

import { useAuth } from "@clerk/expo";
import { useEffect } from "react";

import { apiFetch } from "@/lib/api";
import { deviceCheckToken } from "@/modules/device-check";

const checked = new Set<string>();

export function useDeviceCheck() {
  const { userId, getToken } = useAuth();
  useEffect(() => {
    if (!userId || checked.has(userId)) return;
    checked.add(userId);
    void (async () => {
      const token = await deviceCheckToken();
      if (!token) return;
      await apiFetch("/api/account/device-check", getToken, { method: "POST", body: JSON.stringify({ token }) }).catch(() => undefined);
    })();
  }, [userId, getToken]);
}
