'use client';

import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, preference, toggleTheme } = useTheme();

  const label =
    preference === 'system'
      ? '跟随系统主题'
      : theme === 'dark'
        ? '切换外观'
        : '切换外观';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className={className}
    >
      {preference === 'system' ? (
        <Monitor className="h-4 w-4" />
      ) : theme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}
