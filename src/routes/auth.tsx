import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { MailCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/auth")({
  // Client-only, like the rest of the authenticated app. Server-rendering this
  // form ships a live <form> before React attaches its onSubmit, so a fast tap
  // on Sign in did a native GET to /auth — page reloads, fields clear, no error
  // shown, login silently fails. There is no SEO value in rendering a login box
  // on the server, so the whole class of problem goes away.
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — Dhela" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  // Set only when the account exists but Supabase would not hand us a session,
  // i.e. the project still requires a confirmation click.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<string | null>(null);

  // Supabase's own minimum. Checking here turns a round trip and a red toast
  // into an inline message before the button is even enabled.
  const MIN_PASSWORD = 6;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const signIn = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/dashboard" });
  };

  const signUp = async () => {
    if (password.length < MIN_PASSWORD || password !== confirmPassword) return;
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { org_name: orgName || undefined },
      },
    });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }

    // signUp only returns a session when the project has email confirmation
    // switched off. With it on, this succeeds with session: null — and sending
    // them to /dashboard anyway means the route guard bounces them straight
    // back here, fields cleared, nothing said. Sign in explicitly instead, and
    // if that is genuinely blocked, say why.
    let session = data.session;
    if (!session) {
      const retry = await supabase.auth.signInWithPassword({ email, password });
      session = retry.data.session;
    }
    setLoading(false);

    if (!session) {
      setAwaitingConfirmation(email);
      return;
    }
    toast.success(t("Account created"));
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-12">
        <Link to="/" className="flex items-center">
          <Logo size={30} wordmarkClassName="dhela-word-gold" />
        </Link>
        <div className="space-y-4 max-w-md">
          <p className="font-display text-4xl leading-tight">
            "We used to spend 4 hours a day typing purchase bills. Now our operator just reviews and clicks approve."
          </p>
          <p className="text-sm text-sidebar-foreground/70">— Head of Ops, regional pharma distributor</p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">© Dhela 2026 · {t("Every dhela accounted for.")}</p>
      </div>
      <div className="flex items-center justify-center p-6">
        {awaitingConfirmation ? (
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MailCheck className="h-5 w-5" />
              </div>
              <CardTitle className="text-2xl font-display">{t("Confirm your email")}</CardTitle>
              <CardDescription>
                {t("Your workspace is created. We sent a link to {{email}} — open it and you're in.", { email: awaitingConfirmation })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("Nothing yet? Check spam, or wait a minute and try signing in below.")}
              </p>
              <Button variant="outline" className="w-full" onClick={() => setAwaitingConfirmation(null)}>
                {t("Back to sign in")}
              </Button>
            </CardContent>
          </Card>
        ) : (
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl font-display">{t("Welcome back")}</CardTitle>
            <CardDescription>{t("Sign in or create your distributor workspace.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="signin">{t("Sign in")}</TabsTrigger>
                <TabsTrigger value="signup">{t("Create account")}</TabsTrigger>
              </TabsList>
              <TabsContent value="signin" className="mt-4">
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!loading) signIn(); }}>
                  <div className="space-y-2"><Label htmlFor="signin-email">{t("Email")}</Label><Input id="signin-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="signin-password">{t("Password")}</Label><PasswordInput id="signin-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                  <Button type="submit" className="w-full" disabled={loading}>{loading ? t("Signing in…") : t("Sign in")}</Button>
                </form>
              </TabsContent>
              <TabsContent value="signup" className="mt-4">
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!loading) signUp(); }}>
                  <div className="space-y-2"><Label htmlFor="signup-org">{t("Workspace name")}</Label><Input id="signup-org" autoComplete="organization" placeholder={t("Acme Distributors")} value={orgName} onChange={(e) => setOrgName(e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="signup-email">{t("Work email")}</Label><Input id="signup-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">{t("Password")}</Label>
                    <PasswordInput id="signup-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={tooShort} />
                    {tooShort && (
                      <p className="text-xs text-destructive">
                        {t("At least {{n}} characters.", { n: MIN_PASSWORD })}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">{t("Confirm password")}</Label>
                    <PasswordInput id="signup-confirm" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} aria-invalid={mismatch} />
                    {mismatch && <p className="text-xs text-destructive">{t("Passwords do not match.")}</p>}
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading || password.length < MIN_PASSWORD || password !== confirmPassword}
                  >
                    {loading ? t("Creating…") : t("Create workspace")}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}
