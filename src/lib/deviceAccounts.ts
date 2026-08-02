import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/hooks/usePresence";

/** Nombre maximum de comptes pouvant être créés depuis un même appareil. */
export const MAX_ACCOUNTS_PER_DEVICE = 2;

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

/** Nombre de comptes déjà créés depuis cet appareil. */
export async function countAccountsOnThisDevice(): Promise<number> {
  const deviceId = getDeviceId();
  const { data, error } = await db.rpc("device_account_count", { _device_id: deviceId });
  if (error) return 0;
  return Number(data ?? 0);
}

/** Vrai si l'appareil a atteint la limite de comptes autorisés. */
export async function deviceLimitReached(): Promise<boolean> {
  return (await countAccountsOnThisDevice()) >= MAX_ACCOUNTS_PER_DEVICE;
}

/** Enregistre le compte fraîchement créé sur cet appareil. */
export async function registerAccountOnThisDevice(userId: string): Promise<void> {
  const deviceId = getDeviceId();
  await db.from("device_accounts").insert({ device_id: deviceId, user_id: userId });
}
