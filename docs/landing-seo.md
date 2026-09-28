# Landing page keyword research

Research date: 2026-09-25. Evidence is SERP composition for each query (who ranks, what the
answer boxes say), not a volume tool — treat the ranking as directional, not absolute.

## What the SERPs say

Every top-ranking article for this topic repeats the same fact: **ChatGPT can delete one chat or
all chats, and nothing in between.** OpenAI's own help page confirms it. That gap is the product's
entire reason to exist, so it is the landing page's H1 and its first section.

Established competitors: ChatGPT Bulk Delete (qcrao, plus several same-name clones), AI Toolbox,
GPT Master, ChatGPT Pro Tools (free tier caps batches at 7 chats), TidyGPT, ChatGPT Cleaner.
Most of them lead with "delete everything in one click". None of them leads with *protection* —
that is the opening.

## Intent clusters, ranked by value

| # | Cluster | Representative queries | Priority |
|---|---------|------------------------|----------|
| 1 | Bulk delete | bulk delete ChatGPT chats · delete multiple ChatGPT chats at once · mass delete ChatGPT · how to delete all ChatGPT chats | Primary. Highest volume, most commercial, most crowded. |
| 2 | Selective / protective | delete old ChatGPT chats but keep important ones · select multiple chats ChatGPT · delete chats without deleting all | **Primary differentiator.** Underserved by competitors. |
| 3 | Bulk archive | bulk archive ChatGPT chats · archive all chats ChatGPT · where are archived chats | Secondary. Lower volume, much lower competition. |
| 4 | Age-based | delete ChatGPT chats older than 30 days · auto delete old ChatGPT chats | Secondary. Maps exactly onto the 30/90/180/365 presets. |
| 5 | Safety / privacy | are ChatGPT bulk delete extensions safe · can deleted ChatGPT chats be recovered · 30-day retention | **Conversion driver.** People search this right before installing. |
| 6 | Clutter / organisation | organize ChatGPT chats · ChatGPT sidebar clutter · how to organize 1000+ ChatGPT chats | Tertiary. Better served by blog posts than by the landing page. |

Clusters 2 and 5 are where this product wins: nothing else in the market leads with "pinned and
Project chats are protected" plus "no backend, no analytics, source is public".

## How the page maps to them

| Element | Targets |
|---------|---------|
| `<title>` "Bulk Delete & Archive ChatGPT Chats — Chat Cleanup for Chrome" | 1, 3 |
| H1 "Bulk delete and archive ChatGPT chats — without losing the ones that matter" | 1, 2 |
| Section "ChatGPT has no way to delete multiple chats at once" | 1 |
| Section "How to delete multiple ChatGPT chats at once" (+ `HowTo` JSON-LD) | 1, 2 |
| Feature cards | 1, 3, 4 |
| Privacy band | 5 |
| FAQ (+ `FAQPage` JSON-LD) | 2, 3, 4, 5 |

FAQ questions are worded as the queries themselves, so each one can win a featured snippet
independently of how the page as a whole ranks.

## Not done yet

- **Blog posts** for cluster 6 and the long tail; the landing page should not try to rank for
  everything. Highest-value first posts: "delete old ChatGPT chats but keep the important ones",
  "archive vs delete in ChatGPT", "is a ChatGPT bulk delete extension safe".
- **Chrome Web Store listing** is its own ranking surface. The listing title already carries
  "Bulk Archive & Delete"; keep the short description keyword-led.
- **Backlinks.** The Medium/Tom's Guide/ai-toolbox articles that own these queries are the
  realistic outreach targets once the extension is live.
- **Search Console** — submit `sitemap.xml` after the first deploy.
