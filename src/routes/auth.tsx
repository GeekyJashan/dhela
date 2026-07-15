import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Ledgerly" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { org_name: orgName || undefined },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Account created");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-12">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="h-5 w-5 text-accent" /> Ledgerly
        </Link>
        <div className="space-y-4 max-w-md">
          <p className="font-display text-4xl leading-tight">
            "We used to spend 4 hours a day typing purchase bills. Now our operator just reviews and clicks approve."
          </p>
          <p className="text-sm text-sidebar-foreground/70">— Head of Ops, regional pharma distributor</p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">© Ledgerly 2026</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl font-display">Welcome back</CardTitle>
            <CardDescription>Sign in or create your distributor workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>
              <TabsContent value="signin" className="mt-4">
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!loading) signIn(); }}>
                  <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div className="space-y-2"><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                  <Button type="submit" className="w-full" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
                </form>
              </TabsContent>
              <TabsContent value="signup" className="mt-4">
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!loading) signUp(); }}>
                  <div className="space-y-2"><Label>Workspace name</Label><Input placeholder="Acme Distributors" value={orgName} onChange={(e) => setOrgName(e.target.value)} /></div>
                  <div className="space-y-2"><Label>Work email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div className="space-y-2"><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                  <Button type="submit" className="w-full" disabled={loading}>{loading ? "Creating…" : "Create workspace"}</Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
