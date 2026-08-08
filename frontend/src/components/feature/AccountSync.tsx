import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { hydrateTagsFromServer } from '@/hooks/useTagsStore';
import { hydrateSettingsFromServer } from '@/lib/settings';

/**
 * After login, syncs "tags" and "settings" down from the server (tied to the account).
 * Switching accounts (email change) re-syncs, preventing one account's data from bleeding into the next.
 */
export default function AccountSync() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    void hydrateTagsFromServer();
    void hydrateSettingsFromServer();
  }, [user?.email]);
  return null;
}
