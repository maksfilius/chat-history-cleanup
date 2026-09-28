# Landing page keyword research

Research dates: 2026-09-25, re-run 2026-09-28 after the Store release. Evidence is SERP composition for each query (who ranks, what the
answer boxes say), not a volume tool — treat the ranking as directional, not absolute.

## What the SERPs say

Every top-ranking article for this topic repeats the same fact: **ChatGPT can delete one chat or
all chats, and nothing in between.** OpenAI's own help page confirms it. That gap is the product's
entire reason to exist, so it is the landing page's H1 and its first section.

Established competitors: ChatGPT Bulk Delete (qcrao, plus several same-name clones), ChatGPT
Toolbox (the most feature-complete), AI Toolbox, GPT Master, ChatGPT Pro Tools, TidyGPT,
DeclutterGPT, ChatPilot, ChatGPT History Cleaner, ChatGPT Cleaner.

Two openings they leave:

- **Protection.** They all lead with "delete everything in one click". None leads with pinned and
  Project chats being skipped by default.
- **Free-tier caps.** ChatGPT Pro Tools limits free users to 7 chats per batch; Toolbox limits
  folders and pins. Chat Cleanup is free with no batch cap, which is worth saying out loud.

## Intent clusters, ranked by value

| # | Cluster | Representative queries | Priority |
|---|---------|------------------------|----------|
| 1 | Bulk delete | bulk delete ChatGPT chats · delete multiple ChatGPT chats at once · mass delete ChatGPT · how to delete all ChatGPT chats | Primary. Highest volume, most commercial, most crowded. |
| 2 | Selective / protective | delete old ChatGPT chats but keep important ones · select multiple chats ChatGPT · delete chats without deleting all | **Primary differentiator.** Underserved by competitors. |
| 3 | Bulk archive | bulk archive ChatGPT chats · archive all chats ChatGPT · where are archived chats | Secondary. Lower volume, much lower competition. |
| 4 | Age-based | delete ChatGPT chats older than 30 days · auto delete old ChatGPT chats | Secondary. Maps exactly onto the 30/90/180/365 presets. |
| 5 | Safety / privacy | are ChatGPT bulk delete extensions safe · can deleted ChatGPT chats be recovered · 30-day retention | **Conversion driver.** People search this right before installing. |
| 6 | Clutter / organisation | organize ChatGPT chats · ChatGPT sidebar clutter · how to organize 1000+ ChatGPT chats | Tertiary. Better served by blog posts than by the landing page. |
| 7 | Performance myth | why is ChatGPT so slow · chat history full · does deleting chats speed up ChatGPT | Found on the 09-28 re-run. High volume, and the honest answer is *no* — the lag comes from the long conversation you have open, not the sidebar. Answering it truthfully earns trust; claiming otherwise would be a lie the product cannot back. |

Clusters 2 and 5 are where this product wins: nothing else in the market leads with "pinned and
Project chats are protected" plus "no backend, no analytics, two permissions".

## How the page maps to them

| Element | Targets |
|---------|---------|
| `<title>` "Bulk Delete & Archive ChatGPT Chats — Chat Cleanup for Chrome" | 1, 3 |
| H1 "Bulk delete ChatGPT chats. Keep the ones that matter." | 1, 2 |
| Section "ChatGPT gives you two options. Neither is the one you want." | 1 |
| Section "How to delete multiple ChatGPT chats at once" (+ `HowTo` JSON-LD) | 1, 2 |
| Feature cards | 1, 3, 4 |
| Privacy band | 5 |
| FAQ (+ `FAQPage` JSON-LD) | 2, 3, 4, 5, 7 |

FAQ questions are worded as the queries themselves, so each one can win a featured snippet
independently of how the page as a whole ranks. Thirteen of them as of 2026-09-28, including the
performance myth, export-before-delete, batch limits, and browser support.

## Not done yet

- **Blog posts.** The first two shipped on 2026-09-28 at `/blog/`:
  `delete-old-chatgpt-chats-keep-important-ones` (cluster 2) and
  `is-a-chatgpt-bulk-delete-extension-safe` (cluster 5). Next in order of expected return:
  "archive vs delete in ChatGPT" (cluster 3), "does deleting chats speed up ChatGPT" (cluster 7),
  "how to organize ChatGPT chats" (cluster 6), and last "how to delete multiple ChatGPT chats at
  once" (cluster 1 — the money query, and the hardest; leave it until the domain has some weight).
- **Chrome Web Store listing** is its own ranking surface and, for an extension, probably the
  larger one. The published name is `Chat Cleanup — Bulk Archive & Delete`; it does not contain
  "ChatGPT", which is the word people type into Store search. Worth changing in the next version.
- **Backlinks.** The Medium/Tom's Guide/ai-toolbox articles that own these queries are the
  realistic outreach targets once the extension is live.
- **Search Console** — submit `sitemap.xml` after the first deploy.
