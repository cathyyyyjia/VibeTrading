
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useLocation } from 'wouter';
import { useI18n } from '@/contexts/I18nContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const { session } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useI18n();

  useEffect(() => {
    if (session) {
      setLocation('/');
    }
  }, [session, setLocation]);

  const canSubmit = useMemo(() => {
    return email.trim().length > 0 && password.length > 0 && !loading;
  }, [email, password, loading]);

  const normalizeAuthError = (error: unknown): string => {
    const msg = (error as any)?.message || '';
    if (typeof msg !== 'string') return t('login.authFailed');
    const lower = msg.toLowerCase();
    if (lower.includes('invalid login credentials')) return t('login.invalidCredentials');
    if (lower.includes('email not confirmed')) return t('login.emailNotConfirmed');
    if (lower.includes('password should be at least')) return msg;
    return msg || t('login.authFailed');
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        toast.success(t('login.checkEmail'));
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        toast.success(t('login.loggedIn'));
        setLocation('/');
      }
    } catch (error) {
      toast.error(normalizeAuthError(error));
    } finally {
      setLoading(false);
    }
  };

  // OAuth disabled per current requirements
  if (session) return null;

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Card className="w-[350px]">
        <CardHeader>
          <CardTitle>{isSignUp ? t('login.signUp') : t('login.login')}</CardTitle>
          <CardDescription>
            {isSignUp ? t('login.createAccount') : t('login.enterCredentials')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAuth} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('login.email')}</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('login.password')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {loading ? t('login.loading') : isSignUp ? t('login.signUp') : t('login.login')}
            </Button>
            <div className="text-center text-sm">
              <span
                className="cursor-pointer text-blue-500 hover:underline"
                onClick={() => setIsSignUp(!isSignUp)}
              >
                {isSignUp ? t('login.alreadyHaveAccount') : t('login.noAccount')}
              </span>
            </div>
          </form>
          {/* Third-party OAuth options temporarily removed */}
        </CardContent>
      </Card>
    </div>
  );
}
