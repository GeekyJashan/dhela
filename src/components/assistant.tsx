import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { askAssistant, getAssistantHistory } from "@/lib/assistant.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, X, Send, Loader2, PhoneCall } from "lucide-react";
import { useTranslation } from "react-i18next";

type Msg = { role: "user" | "assistant"; text: string };

const founderLink = (text: string) => {
  const phone = (import.meta.env.VITE_SUPPORT_PHONE ?? "").replace(/\D/g, "");
  if (!phone) return null;
  return `https://wa.me/${phone.length === 10 ? "91" + phone : phone}?text=${encodeURIComponent(text)}`;
};

export function Assistant() {
  const { t } = useTranslation();
  const ask = useServerFn(askAssistant);
  const fetchHistory = useServerFn(getAssistantHistory);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const loadedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    fetchHistory().then(history => {
      const msgs: Msg[] = [];
      for (const h of history as { question: string; answer: string }[]) {
        msgs.push({ role: "user", text: h.question });
        msgs.push({ role: "assistant", text: h.answer });
      }
      setMessages(msgs);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy, open]);

  const send = async (q?: string) => {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    setInput("");
    setMessages(m => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const res = await ask({ data: { question } });
      setMessages(m => [...m, { role: "assistant", text: res.answer }]);
      setUsage({ used: res.aiUsedThisMonth, limit: res.aiLimitPerMonth });
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  const callLink = founderLink(t("Hi Jashan! I'm using Ledgerly and would like to talk."));

  const suggestions = [
    t("How much do retailers owe me right now?"),
    t("Profit this month, product by product?"),
    t("Which invoices are unpaid for more than 30 days?"),
  ];

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 h-13 rounded-full bg-primary text-primary-foreground shadow-lg px-4 py-3 flex items-center gap-2 hover:opacity-90 transition print:hidden"
        title={t("Ask Ledgerly Assistant")}
      >
        <Sparkles className="h-5 w-5" />
        <span className="text-sm font-medium">{t("Ask AI")}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[380px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-background border rounded-xl shadow-2xl flex flex-col print:hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Sparkles className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-semibold leading-none">{t("Ledgerly Assistant")}</div>
          {usage && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {t("{{n}} AI questions/extractions left this month", { n: Math.max(0, usage.limit - usage.used) })}
            </div>
          )}
        </div>
        {callLink && (
          <a href={callLink} target="_blank" rel="noreferrer"
            className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
            <PhoneCall className="h-3 w-3" /> {t("Book a call")}
          </a>
        )}
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground ml-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {!messages.length && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("Ask anything about your invoices, retailers, products, orders or profit — answers come straight from your own data.")}
            </p>
            {suggestions.map(s => (
              <button key={s} onClick={() => send(s)}
                className="block w-full text-left text-sm border rounded-lg px-3 py-2 hover:bg-muted/60 transition">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={
              m.role === "user"
                ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap"
                : "bg-muted rounded-2xl rounded-bl-sm px-3 py-2 text-sm max-w-[90%] whitespace-pre-wrap"
            }>
              {m.text}
              {m.role === "assistant" && callLink && i === messages.length - 1 && !busy && (
                <div className="mt-2 pt-2 border-t border-border/60">
                  <a
                    href={founderLink(t("Hi Jashan! About my Ledgerly question: \"{{q}}\" — the answer didn't look right / I have a feature request.", { q: messages[i - 1]?.text?.slice(0, 150) ?? "" })) ?? "#"}
                    target="_blank" rel="noreferrer"
                    className="text-[11px] text-muted-foreground hover:text-primary hover:underline"
                  >
                    {t("Wrong answer or missing feature? Talk to Jashan →")}
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Checking your data…")}
          </div>
        )}
      </div>

      <div className="p-3 border-t flex gap-2 items-end">
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={t("e.g. Profit on iphone from 1 July to today?")}
          rows={1}
          className="min-h-[40px] max-h-28 resize-none text-sm"
        />
        <Button size="icon" onClick={() => send()} disabled={busy || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
