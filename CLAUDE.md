# Dhela — working notes

## Shipping a feature means updating the assistant's context

`PLATFORM_GUIDE` in `src/lib/assistant.functions.ts` is what the in-app
assistant knows about how Dhela is laid out. It is not documentation — it is
the thing a customer actually talks to.

**Update it in the same commit whenever you:**

- add, remove or rename a screen, or move one between sidebar groups
- change the text on a button, tab, radio option or field label
- change what a step does, or the order of steps in a flow
- add or remove a limit (file size, page count, batch size, quota)
- change what counts against the AI quota
- gate something behind a role (platform admin, org admin)

**Why this is not optional.** A distributor asks the assistant "can I bring my
Tally data in?" or "how do I upload a bill that runs to three pages?" If the
guide is stale, the assistant says the feature does not exist, or sends them to
a button that has been renamed. They conclude Dhela cannot do it — and it is
the shipped feature that gets blamed, not the prompt. A wrong answer here is
worse than no answer: it churns a customer who was already trying to succeed.

**How to write the entry.** Give the whole path someone can follow without
guessing: sidebar group, then screen, then what to press, numbered when there
is more than one step. Quote labels **exactly** as they render, because the
person is looking at those words. Say what happens after the last step, and
call out the step that actually matters (approving is what moves stock;
issuing is what deducts it; importing does not bring old bills).

**Then verify it, don't assume it.** The prompt is also the voice assistant's
(`src/lib/live.functions.ts` imports the same `systemPrompt`), so a mistake
ships to both. Run the real questions a customer would ask through the real
prompt and read the answers — that is how the "press Upload & extract, then
choose files" ordering bug was caught, and how a wrong quota claim was found
still being repeated to users.

**Facts must trace to the code, not to memory.** The guide once claimed AI-read
order uploads consumed the AI quota. They never did: `getOrgBilling` counts
rows in `invoices` with `extraction_engine='ai'` plus `assistant_messages`, and
orders live in their own table. Before writing a limit or a rule into the
guide, go and read the code that enforces it.
