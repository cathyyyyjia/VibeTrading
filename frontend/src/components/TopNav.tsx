import { useEffect, useMemo, useState } from "react";
import { Bell, Languages, Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useI18n } from "@/contexts/I18nContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { NavTab } from "@/types";
import { getMyProfile, updateMyProfile, type UserProfile } from "@/lib/api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function TopNav() {
  const [activeTab, setActiveTab] = useState<NavTab>("backtest");
  const [profileOpen, setProfileOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const { theme, toggleTheme } = useTheme();
  const { locale, toggleLocale, t } = useI18n();
  const { user, signOut } = useAuth();

  const tabs: { id: NavTab; label: string; disabled: boolean }[] = [
    { id: "backtest", label: t("nav.backtest"), disabled: false },
    { id: "paper", label: t("nav.paper"), disabled: false },
    { id: "live", label: t("nav.live"), disabled: true }
  ];

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      return () => {
        cancelled = true;
      };
    }
    getMyProfile()
      .then((next) => {
        if (cancelled) return;
        setProfile(next);
        setDisplayName(next.displayName || "");
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
    const fromAuthDisplayName = typeof user?.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "";
    if (fromAuthDisplayName) return fromAuthDisplayName;
    const fromAuthName = typeof user?.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "";
    if (fromAuthName) return fromAuthName;
    return user?.email?.split("@")[0] || t("nav.user");
  }, [profile?.displayName, t, user?.email, user?.user_metadata?.display_name, user?.user_metadata?.name]);

  const shownEmail = useMemo(() => profile?.email || user?.email || "-", [profile?.email, user?.email]);

  const onSaveProfile = async () => {
    try {
      setSavingProfile(true);
      const normalizedDisplayName = displayName.trim() || null;
      const [updated, authResult] = await Promise.all([
        updateMyProfile({ displayName: normalizedDisplayName }),
        supabase.auth.updateUser({
          data: {
            display_name: normalizedDisplayName,
            name: normalizedDisplayName,
          },
        }),
      ]);
      if (authResult.error) {
        throw authResult.error;
      }
      setProfile(updated);
      setDisplayName(updated.displayName || "");
      setProfileOpen(false);
      toast.success(t("nav.profileUpdated"));
    } catch (e: any) {
      toast.error(e?.message || t("nav.profileUpdateFailed"));
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <header className="h-14 border-b border-border bg-background flex items-center justify-between px-5 shrink-0">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-background"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-base font-semibold tracking-tight text-foreground">Aipha</span>
        </div>

        <nav className="flex items-center bg-muted rounded-lg p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-all duration-150 ${
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : tab.disabled
                    ? "text-muted-foreground/40 cursor-not-allowed"
                    : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-muted transition-colors group"
          title={theme === "light" ? t("nav.switchToDark") : t("nav.switchToLight")}
        >
          {theme === "light" ? (
            <Moon className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
          ) : (
            <Sun className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
          )}
        </button>

        <button
          onClick={toggleLocale}
          className="px-2 py-1.5 rounded-lg hover:bg-muted transition-colors group flex items-center gap-1.5"
          title={locale === "en" ? t("nav.switchToChinese") : t("nav.switchToEnglish")}
        >
          <Languages className="w-[18px] h-[18px] text-muted-foreground group-hover:text-foreground transition-colors" />
          <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
            {locale === "en" ? "EN" : "中"}
          </span>
        </button>

        <div className="w-px h-6 bg-border mx-1" />

        <button className="relative p-1.5 rounded-md hover:bg-muted transition-colors">
          <Bell className="w-[18px] h-[18px] text-muted-foreground" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
        </button>

        <div className="w-px h-6 bg-border mx-1" />

        <div className="flex items-center gap-2.5">
          <div className="text-right">
            <div className="text-sm font-medium text-foreground leading-tight">{shownName}</div>
            <div className="text-[11px] text-muted-foreground leading-tight">{shownEmail}</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold hover:opacity-90 transition-opacity">
                {shownName[0]?.toUpperCase() || "U"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setProfileOpen(true)}>{t("nav.profile")}</DropdownMenuItem>
              <DropdownMenuItem onClick={signOut}>{t("nav.logout")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("nav.profileTitle")}</DialogTitle>
            <DialogDescription>{t("nav.profileDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-email">{t("nav.email")}</Label>
              <Input id="profile-email" value={profile?.email || user?.email || ""} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-display-name">{t("nav.displayName")}</Label>
              <Input
                id="profile-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={120}
                placeholder={t("nav.enterDisplayName")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)} disabled={savingProfile}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onSaveProfile} disabled={savingProfile}>
              {savingProfile ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
