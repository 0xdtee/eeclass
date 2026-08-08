import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { hydrateTagsFromServer } from '@/hooks/useTagsStore';
import { hydrateSettingsFromServer } from '@/lib/settings';

/**
 * 登录后把「标签」「设置」从服务器同步下来(跟着账号走)。
 * 账号切换(email 变化)会重新同步,避免上一个账号的数据串到下一个。
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
