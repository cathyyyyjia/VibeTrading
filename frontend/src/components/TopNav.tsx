// ============================================================
// TopNav - Top navigation bar
// Design: Swiss Precision - clean, minimal, fintech feel
// Features: Theme toggle (Sun/Moon) + Language toggle (EN/中)
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { Bell, Sun, Moon, Languages } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useI18n } from '@/contexts/I18nContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { NavTab } from '@/types';
import { getMyProfile, updateMyProfile, type UserProfile } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function TopNav() {
  const [activeTab, setActiveTab] = useState<NavTab>('backtest');
  const [profileOpen, setProfileOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const { theme, toggleTheme } = useTheme();
  const { locale, toggleLocale, t } = useI18n();
  const { user, signOut } = useAuth();

  const tabs: { id: NavTab; label: string; disabled: boolean }[] = [
    { id: 'backtest', label: t('nav.backtest'), disabled: false },
    { id: 'paper', label: t('nav.paper'), disabled: false },
    { id: 'live', label: t('nav.live'), disabled: true },
  ];

  useEffect(() => {
    let cancelled = false;
    if (!user) return () => { cancelled = true; };

    getMyProfile()
      .then((next) => {
        if (cancelled) return;
        setProfile(next);
        setDisplayName(next.displayName || '');
      })
      .catch(() => {
        if (cancelled) return;
        setProfile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const shownName = useMemo(() => {
    const candidate = profile?.displayName?.trim();
    if (candidate) return candidate;
    return user?.email?.split('@')[0] || 'User';
  }, [profile?.displayName, user?.email]);

  const shownProvider = useMemo(() => {
    return user?.app_metadata?.provider || 'Email';
  }, [user?.app_metadata?.provider]);

  const onSaveProfile = async () => {
    try {
      setSavingProfile(true);
      const updated = await updateMyProfile({ displayName: displayName.trim() || null });
      setProfile(updated);
      setDisplayName(updated.displayName || '');
      setProfileOpen(false);
      toast.success('Profile updated');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

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
            <div className="text-sm font-medium text-foreground leading-tight">{shownName}</div>
            <div className="text-[11px] text-muted-foreground leading-tight">{shownProvider}</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold hover:opacity-90 transition-opacity">
                {shownName[0]?.toUpperCase() || 'U'}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={signOut}>
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>Manage your public display information.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" value={profile?.email || user?.email || ''} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-display-name">Display name</Label>
              <Input
                id="profile-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={120}
                placeholder="Enter display name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)} disabled={savingProfile}>
              Cancel
            </Button>
            <Button onClick={onSaveProfile} disabled={savingProfile}>
              {savingProfile ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
