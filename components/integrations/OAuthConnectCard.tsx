'use client';

/**
 * Shared Connect / Reconnect / Disconnect actions for OAuth MCP providers.
 */

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type OAuthConnectStatus = {
  connected: boolean;
  available?: boolean;
  label?: string;
  needsReconnect?: boolean;
} | null;

type OAuthConnectCardBodyProps = {
  status: OAuthConnectStatus;
  connectedLabel: string;
  needsReconnectLabel: string;
  notConfiguredLabel: string;
  connectBody: string;
};

export function OAuthConnectStatusText({
  status,
  connectedLabel,
  needsReconnectLabel,
  notConfiguredLabel,
  connectBody,
}: OAuthConnectCardBodyProps) {
  if (status?.connected && status.needsReconnect) {
    return (
      <p className="mt-2 text-sm leading-6 text-amber-700 dark:text-amber-400">
        {needsReconnectLabel}
        {status.label ? ` · ${status.label}` : ''}
      </p>
    );
  }
  if (status?.connected) {
    return (
      <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
        {connectedLabel}
        {status.label ? ` · ${status.label}` : ''}
      </p>
    );
  }
  if (status?.available === false) {
    return (
      <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{notConfiguredLabel}</p>
    );
  }
  return (
    <p className="mt-2 max-w-sm text-sm leading-6 text-stone-500 dark:text-stone-400">
      {connectBody}
    </p>
  );
}

type OAuthConnectActionsProps = {
  status: OAuthConnectStatus;
  busy: boolean;
  startPath: string;
  connectLabel: string;
  reconnectLabel: string;
  disconnectLabel: string;
  onDisconnect: () => void;
};

export function OAuthConnectActions({
  status,
  busy,
  startPath,
  connectLabel,
  reconnectLabel,
  disconnectLabel,
  onDisconnect,
}: OAuthConnectActionsProps) {
  const unavailable = status?.available === false;
  const needsReconnect = Boolean(status?.connected && status.needsReconnect);
  const connectedOk = Boolean(status?.connected && !status.needsReconnect);

  const disconnectBtn = (
    <Button
      type="button"
      disabled={busy}
      onClick={onDisconnect}
      className="h-11 w-full rounded-xl border border-red-200 bg-white text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-stone-700 dark:bg-stone-800 dark:text-red-300/90 dark:hover:border-stone-600 dark:hover:bg-stone-700 dark:hover:text-red-200"
    >
      {disconnectLabel}
    </Button>
  );

  const startLink = (label: string) => (
    <a
      href={unavailable ? undefined : startPath}
      aria-disabled={unavailable}
      onClick={(e) => {
        if (unavailable) e.preventDefault();
      }}
      className={cn(
        'inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold transition-colors',
        unavailable
          ? 'cursor-not-allowed bg-stone-200 text-stone-400 dark:bg-stone-800'
          : 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white',
      )}
    >
      {label}
    </a>
  );

  if (needsReconnect) {
    return (
      <div className="mt-6 w-full max-w-sm space-y-2">
        {startLink(reconnectLabel)}
        {disconnectBtn}
      </div>
    );
  }

  if (connectedOk) {
    return <div className="mt-6 w-full max-w-sm">{disconnectBtn}</div>;
  }

  return <div className="mt-6 w-full max-w-sm">{startLink(connectLabel)}</div>;
}
