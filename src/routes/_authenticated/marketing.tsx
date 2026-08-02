import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Sparkles, Send, Copy, Trash2, Loader2, ExternalLink, Linkedin, Twitter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { draftPost, listPosts, publishPost, deletePost } from "@/lib/marketing.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/marketing")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    const meta = data.user?.app_metadata as { platform_admin?: boolean } | undefined;
    if (meta?.platform_admin !== true) throw redirect({ to: "/dashboard" });
  },
  head: () => ({ meta: [{ title: "Marketing — Dhela" }] }),
  component: Marketing,
});

const LIMITS = { linkedin: 2800, twitter: 275 } as const;

function Marketing() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const load = useServerFn(listPosts);
  const draft = useServerFn(draftPost);
  const publish = useServerFn(publishPost);
  const remove = useServerFn(deletePost);

  const [channel, setChannel] = useState<"linkedin" | "twitter">("linkedin");
  const [language, setLanguage] = useState<"en" | "hi" | "pa">("en");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const { data } = useQuery({ queryKey: ["marketing"], queryFn: () => load({ data: undefined }) });
  const posts = (data?.posts ?? []).filter(p => p.channel === channel);

  const write = async () => {
    setBusy(true);
    try {
      const res = await draft({ data: { channel, language, topic: topic.trim() || undefined } });
      if (res.overLimit) {
        // Said rather than silently truncated — a post cut mid-sentence by the
        // platform is worse than one you were told to trim.
        toast.warning(t("Over the limit by {{n}} characters — trim before posting.", {
          n: res.post.body.length - LIMITS[channel],
        }));
      }
      setTopic("");
      qc.invalidateQueries({ queryKey: ["marketing"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl">{t("Marketing")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("Write a post grounded in what Dhela actually does, then put it out.")}
        </p>
      </div>

      <Tabs value={channel} onValueChange={v => setChannel(v as typeof channel)}>
        <TabsList>
          <TabsTrigger value="linkedin"><Linkedin className="h-3.5 w-3.5 mr-1.5" /> LinkedIn</TabsTrigger>
          <TabsTrigger value="twitter"><Twitter className="h-3.5 w-3.5 mr-1.5" /> X</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <Input className="flex-1 min-w-[240px]" value={topic} onChange={e => setTopic(e.target.value)}
            placeholder={t("What about? Leave empty and it picks an angle you haven't used.")} />
          <Select value={language} onValueChange={v => setLanguage(v as typeof language)}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="hi">हिंदी</SelectItem>
              <SelectItem value="pa">ਪੰਜਾਬੀ</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={write} disabled={busy}>
            {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("Writing…")}</>
                  : <><Sparkles className="h-4 w-4 mr-2" /> {t("Write a post")}</>}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {posts.map(p => {
          const body = edits[p.id] ?? p.body;
          const over = body.length - LIMITS[p.channel as "linkedin" | "twitter"];
          const published = p.status === "published";
          return (
            <Card key={p.id} className={published ? "border-success/40" : p.status === "failed" ? "border-destructive/40" : ""}>
              <CardContent className="p-4 space-y-3">
                <Textarea rows={channel === "twitter" ? 4 : 9} value={body} disabled={published}
                  onChange={e => setEdits(s => ({ ...s, [p.id]: e.target.value }))}
                  className="text-sm leading-relaxed" />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={over > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
                    {body.length} / {LIMITS[p.channel as "linkedin" | "twitter"]}
                  </span>
                  {p.language !== "en" && <span className="text-muted-foreground">· {p.language}</span>}
                  {published && p.external_url && (
                    <a href={p.external_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> {t("View post")}
                    </a>
                  )}
                  {p.status === "failed" && <span className="text-destructive">· {p.error?.slice(0, 90)}</span>}

                  <span className="flex-1" />
                  <Button size="sm" variant="ghost" onClick={() => {
                    navigator.clipboard.writeText(body);
                    toast.success(t("Copied"));
                  }}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> {t("Copy")}
                  </Button>
                  {!published && (
                    <Button size="sm" disabled={sending === p.id || over > 0} onClick={async () => {
                      setSending(p.id);
                      try {
                        // Whatever is on screen is what goes out.
                        const r = await publish({ data: { id: p.id, body } });
                        toast.success(r.url ? t("Posted") : t("Posted (no link returned)"));
                        qc.invalidateQueries({ queryKey: ["marketing"] });
                      } catch (e) { toast.error((e as Error).message); }
                      finally { setSending(null); }
                    }}>
                      {sending === p.id ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        : <Send className="h-3.5 w-3.5 mr-1.5" />}
                      {t("Post now")}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={async () => {
                    await remove({ data: { id: p.id } });
                    qc.invalidateQueries({ queryKey: ["marketing"] });
                  }}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!posts.length && (
          <p className="text-center text-sm text-muted-foreground py-10">
            {t("Nothing drafted for this channel yet.")}
          </p>
        )}
      </div>
    </div>
  );
}
