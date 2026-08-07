'use client';

/**
 * Logged-in account cookie state (`/api/account`).
 * Independent of chat sessions / integrations.
 */

import { useCallback, useState } from 'react';
import {
  bindAccountApiKey,
  fetchAccountStatus,
  unbindAccount,
} from '@/lib/chat/account/client';

export function useChatAccount() {
  const [isAccountBound, setIsAccountBound] = useState(false);
  const [accountUsername, setAccountUsername] = useState<string | null>(null);

  const refreshAccountStatus = useCallback(async () => {
    const status = await fetchAccountStatus();
    setIsAccountBound(status.bound);
    setAccountUsername(status.username);
    return status;
  }, []);

  const bindWithApiKey = useCallback(
    async (apiKey: string) => {
      const data = await bindAccountApiKey(apiKey);
      if (data?.username) setAccountUsername(String(data.username));
      return refreshAccountStatus();
    },
    [refreshAccountStatus],
  );

  const disconnectAccountCore = useCallback(async () => {
    await unbindAccount();
    setIsAccountBound(false);
    setAccountUsername(null);
  }, []);

  return {
    isAccountBound,
    setIsAccountBound,
    accountUsername,
    setAccountUsername,
    refreshAccountStatus,
    bindWithApiKey,
    disconnectAccountCore,
  };
}
