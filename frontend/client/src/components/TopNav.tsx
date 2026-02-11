// ============================================================
// TopNav - Top navigation bar
// Design: Swiss Precision - clean, minimal, fintech feel
// Features: Theme toggle (Sun/Moon) + Language toggle (EN/中)
// ============================================================

import { useState } from 'react';
import { Bell, Sun, Moon, Languages } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useI18n } from '@/contexts/I18nContext';
import { useAuth } from '@/contexts/AuthContext';
import type { NavTab } from '@/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function TopNav() {
  const [activeTab, setActiveTab] = useState<NavTab>('backtest');
  const { theme, toggleTheme } = useTheme();
  const { locale, toggleLocale, t } = useI18n();
  const { user, signOut } = useAuth();

  const tabs: { id: NavTab; label: string; disabled: boolean }[] = [
    { id: 'backtest', label: t('nav.backtest'), disabled: false },
    { id: 'paper', label: t('nav.paper'), disabled: false },
    { id: 'live', label: t('nav.live'), disabled: true },
  ];

  return (
    <header className="h-14 border-b border-border bg-background flex items-center justify-between px-5 shrink-0">
      {/* Left: Logo + Tabs */}
      <div className="flex items-center gap-6">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-background">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-base font-semibold tracking-tight text-foreground">Aipha</span>
        </div>

        {/* Tabs */}
        <nav className="flex items-center bg-muted rounded-lg p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
              className={`
                px-3.5 py-1.5 text-sm font-medium rounded-md transition-all duration-150
                ${activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : tab.disabled
                    ? 'text-muted-foreground/40 cursor-not-allowed'
                    : 'text-muted-foreground hover:text-foreground'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Right: Theme + Language + Notifications + User */}
      <div className="flex items-center gap-2">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-muted transition-colors group"
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {theme === 'light' ? (
            <Moon className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
          ) : (
            <Sun className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
          )}
        </button>

        {/* Language Toggle */}
        <button
          onClick={toggleLocale}
          className="px-2 py-1.5 rounded-lg hover:bg-muted transition-colors group flex items-center gap-1.5"
          title={locale === 'en' ? 'Switch to Chinese' : 'Switch to English'}
        >
          <Languages className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
          <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
            {locale === 'en' ? 'EN' : '中'}
          </span>
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-border mx-1" />

        {/* Notification Bell */}
        <button className="relative p-1.5 rounded-md hover:bg-muted transition-colors">
          <Bell className="w-[18px] h-[18px] text-muted-foreground" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-border mx-1" />

        {/* User */}
        <div className="flex items-center gap-2.5">
          <div className="text-right">
            <div className="text-sm font-medium text-foreground leading-tight">{user?.email || 'User'}</div>
            <div className="text-[11px] text-muted-foreground leading-tight">{user?.app_metadata?.provider || 'Email'}</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold hover:opacity-90 transition-opacity">
                {user?.email?.[0].toUpperCase() || 'U'}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={signOut}>
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
