
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { I18nProvider } from "./contexts/I18nContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { useI18n } from "./contexts/I18nContext";
import { Route, Switch, useLocation } from "wouter";
import { useEffect } from "react";

// Protected Route Component
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { session, loading } = useAuth();
  const { t } = useI18n();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !session) {
      setLocation("/login");
    }
  }, [loading, session, setLocation]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return <Component />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <I18nProvider>
          <TooltipProvider>
            <AuthProvider>
              <Toaster position="top-right" richColors closeButton />
              <Switch>
                <Route path="/login" component={Login} />
                <Route path="/">
                  <ProtectedRoute component={Home} />
                </Route>
                <Route>
                  <ProtectedRoute component={Home} />
                </Route>
              </Switch>
            </AuthProvider>
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
