import {
  apiAdapterFor, assertAccountContext, listAll, verify, type Inventory,
} from '../chatgpt/api.ts';
import { removeRow } from '../chatgpt/dom.ts';
import { formatAge } from '../cleanup/age.ts';
import { allRules, reviewSet, ruleCount, type CleanupRule } from '../cleanup/filters.ts';
import { protectionMap, protectionSummary } from '../cleanup/protections.ts';
import { projectGroups, selectAll, selectRange } from '../cleanup/selection.ts';
import { extensionAlive, onKeyChange, readKeyState, writeKey } from '../storage/local.ts';
import { loadProtected, setProtected } from '../storage/protectedChats.ts';
import { OperationQueue, type OpKind, type Operation, type QueueDeps } from '../queue/operationQueue.ts';
import {
  acquireLease, HEARTBEAT_MS, newOwnerId, releaseLease, renewLease, withExclusiveBatchLock,
} from '../queue/lease.ts';
import { clearBatch, loadRestorePoint, saveBatch } from '../queue/persistence.ts';
import type { Conversation } from '../types/conversation.ts';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const CONSENT_KEY = 'privacyConsentVersion';
const CONSENT_VERSION = 1;

/**
 * The user can select manually or start from a deterministic age/untitled rule. Rules never
 * infer importance and never include protected chats by default.
 *
 * The list is our own panel rather than checkboxes overlaid on ChatGPT's sidebar: the sidebar
 * is a subset of the truth — it omits every conversation inside a project.
 */
const CSS = `
:host{--cc-accent:#d0f2ae;--cc-accent-hover:#e1ffc4;--cc-accent-ink:#24351c;
 --cc-accent-soft:#d0f2ae12;--cc-accent-border:#d0f2ae40}
.cc-root{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:420px;max-height:78vh;
 display:flex;flex-direction:column;border-radius:12px;overflow:hidden;
 background:#181818;color:#ececec;border:1px solid #333;box-shadow:0 8px 40px #000a;
 font:13px/1.5 system-ui,-apple-system,sans-serif}
.cc-hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #2c2c2c}
.cc-hd b{flex:1;font-size:14px}
.cc-sum{padding:10px 14px;border-bottom:1px solid #2c2c2c}
.cc-total{font-size:14px}
.cc-selrow{display:flex;align-items:center;gap:6px;margin-top:8px}
.cc-sel{flex:1;color:#9b9b9b}
.cc-selrow:has(.cc-none:not(:disabled)) .cc-sel{color:var(--cc-accent)}
.cc-selrow button{background:#272727;border:1px solid #424242;border-radius:7px;color:#e0e0e0;
 cursor:pointer;padding:5px 10px;font:inherit;transition:background .15s,border-color .15s}
.cc-selrow button:not(:disabled):hover{background:#343434;border-color:#626262}
.cc-selrow .cc-all{background:var(--cc-accent-soft);border-color:var(--cc-accent-border);color:var(--cc-accent)}
.cc-selrow .cc-all:not(:disabled):hover{background:#d0f2ae24;border-color:var(--cc-accent)}
.cc-selrow button:disabled{opacity:.4;cursor:not-allowed}
.cc-rules{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:9px}
.cc-rules-label{color:#8b8b8b;font-size:12px;margin-right:2px}
.cc-root :is(button,input):focus-visible,.cc-open:focus-visible{outline:2px solid var(--cc-accent);outline-offset:3px}
.cc-note{margin-top:6px;color:#8b8b8b;font-size:12px;white-space:pre-line}
.cc-grp{display:flex;align-items:center;gap:8px;padding:9px 14px 7px;border-top:1px solid #2c2c2c;
 background:#1c1c1c;cursor:pointer;position:sticky;top:0}
.cc-grp:hover{background:#222}
.cc-grp-chev{flex:none;width:14px;height:14px;position:relative}
.cc-grp-chev::before{content:"";position:absolute;top:3px;left:3px;width:7px;height:7px;
 border-right:2px solid #b4b4b4;border-bottom:2px solid #b4b4b4;
 transform:rotate(-45deg);transform-origin:60% 60%;transition:transform .13s ease}
.cc-grp[aria-expanded="true"] .cc-grp-chev::before{transform:rotate(45deg)}
.cc-grp:hover .cc-grp-chev::before{border-color:#ececec}
.cc-grp-hint{color:#7a7a7a;font-size:12px;flex:none}
.cc-grp:hover .cc-grp-hint{color:#9b9b9b}
.cc-grp-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-grp-meta{color:#8b8b8b;font-size:12px;flex:1;white-space:nowrap}
.cc-grp button{background:none;border:none;color:var(--cc-accent);cursor:pointer;padding:0;font:inherit;flex:none}
.cc-row.cc-in-grp{padding-left:32px}
.cc-chip{padding:4px 9px;border-radius:999px;border:1px solid #3a3a3a;background:#222;color:#d4d4d4;cursor:pointer;font:12px system-ui,sans-serif}
.cc-chip[aria-pressed="true"]{background:var(--cc-accent-soft);border-color:var(--cc-accent-border);color:var(--cc-accent)}
.cc-chip:disabled{opacity:.35;cursor:not-allowed}
.cc-chip b{font-weight:600;opacity:.75;margin-left:5px}
.cc-list{overflow:auto;flex:1;min-height:0}
.cc-lock{background:none;border:none;cursor:pointer;padding:0 2px;font-size:12px;flex:none;opacity:.3}
.cc-lock[aria-pressed="true"]{opacity:1}
.cc-row.cc-prot .cc-t{color:#9b9b9b}
.cc-row{display:flex;gap:10px;align-items:center;padding:8px 14px;cursor:pointer}
.cc-row:hover{background:#232323}
.cc-row input{margin:0;flex:none;cursor:pointer;accent-color:var(--cc-accent)}
.cc-row:has(input:checked){background:var(--cc-accent-soft)}
.cc-row:has(input:checked):hover{background:#d0f2ae1c}
.cc-t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-age{color:#8b8b8b;font-variant-numeric:tabular-nums;flex:none}
.cc-tag{font-size:11px;color:#c8a15a;border:1px solid #5a4a2a;border-radius:4px;padding:0 5px;flex:none}
.cc-ft{padding:12px 14px;border-top:1px solid #2c2c2c;display:flex;gap:8px;align-items:center}
.cc-ft button{flex:1;padding:8px;border-radius:8px;border:1px solid #3a3a3a;background:#2a2a2a;color:#ececec;cursor:pointer}
.cc-ft button:disabled{opacity:.45;cursor:not-allowed}
.cc-x{background:none;border:none;color:#9b9b9b;font-size:18px;cursor:pointer;line-height:1}
.cc-warn{padding:8px 14px;background:#3a2418;color:#ffb782;border-bottom:1px solid #533}
.cc-dlg{position:absolute;inset:0;background:#000c;display:flex;align-items:center;justify-content:center;padding:20px}
.cc-dlg>div{background:#1f1f1f;border:1px solid #3a3a3a;border-radius:10px;padding:16px;max-width:330px;
 max-height:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden}
.cc-dlg h3{margin:0 0 8px;font-size:14px}
.cc-dlg p{margin:0 0 14px;color:#b4b4b4;white-space:pre-line;overflow:auto;min-height:0}
.cc-dlg-items{max-height:150px;overflow:auto;margin:0 0 14px;padding:8px 8px 8px 28px;
 border:1px solid #393939;border-radius:7px;color:#c9c9c9;background:#181818}
.cc-dlg-items li{padding:2px 0;overflow-wrap:anywhere}
.cc-dlg .cc-danger{background:#7f1d1d;border-color:#a33}
.cc-dlg-btns{display:flex;gap:8px;flex:none}
.cc-dlg-btns button{flex:1;padding:8px;border-radius:8px;border:1px solid #3a3a3a;background:#2a2a2a;color:#ececec;cursor:pointer}
.cc-ft .cc-primary,.cc-ft .cc-back,.cc-dlg-btns .cc-ok:not(.cc-danger){
 background:var(--cc-accent);border-color:var(--cc-accent);color:var(--cc-accent-ink);font-weight:600}
.cc-ft .cc-primary:not(:disabled):hover,.cc-ft .cc-back:hover,.cc-dlg-btns .cc-ok:not(.cc-danger):hover{
 background:var(--cc-accent-hover);border-color:var(--cc-accent-hover)}
.cc-prog{padding:14px;display:flex;flex-direction:column;gap:10px}
.cc-stat{margin:0;font:inherit}
.cc-bar{height:6px;border-radius:3px;background:#2c2c2c;overflow:hidden}
.cc-bar>i{display:block;height:100%;background:var(--cc-accent);transition:width .2s}
.cc-result{text-align:center;padding:18px 12px 12px}
.cc-result-icon{width:80px;height:80px;margin:0 auto 18px;border-radius:50%;
 color:#91a4b7;background:#242b32;display:grid;place-items:center}
.cc-result-icon svg{width:64px;height:64px;fill:none;stroke:currentColor;stroke-width:2.5;
 stroke-linecap:round;stroke-linejoin:round}
.cc-result-icon circle{stroke-width:1;opacity:.35}
.cc-success .cc-result-icon{color:var(--cc-accent);background:radial-gradient(circle,#35462a,#252e20);
 box-shadow:0 0 0 7px #d0f2ae09,0 0 35px #d0f2ae12;animation:cc-pop .55s cubic-bezier(.2,.8,.2,1) both}
.cc-success .cc-check{stroke-dasharray:40;stroke-dashoffset:0;animation:cc-check .4s .2s ease both}
.cc-result-kicker{margin:0 0 6px;color:#a9b1ba;font-size:11px;letter-spacing:.1em;text-transform:uppercase}
.cc-success .cc-result-kicker{color:var(--cc-accent)}
.cc-result .cc-stat{font-size:23px;line-height:1.25;font-weight:600;letter-spacing:-.5px}
.cc-result-copy{margin:10px auto 0;color:#a4a4a4;max-width:290px;line-height:1.6}
.cc-attention .cc-result-icon{color:#efbd7f;background:#352b20}
.cc-ft .cc-back{font:600 13px system-ui,sans-serif;
 padding:10px 12px;transition:background .15s}
.cc-empty{padding:36px 24px;text-align:center;color:#9b9b9b}
.cc-empty b{display:block;color:#ececec;font-size:15px;margin-bottom:6px}
@keyframes cc-pop{from{opacity:0;transform:scale(.75)}to{opacity:1;transform:scale(1)}}
@keyframes cc-check{from{stroke-dashoffset:40}to{stroke-dashoffset:0}}
@media(prefers-reduced-motion:reduce){
 .cc-success .cc-result-icon,.cc-success .cc-check{animation:none}
 .cc-bar>i,.cc-selrow button,.cc-ft .cc-back{transition:none}
}
.cc-fail{color:#ff9b9b;font-size:12px;max-height:140px;overflow:auto}
.cc-fail div{padding:2px 0}
.cc-open{position:fixed;right:16px;bottom:16px;z-index:2147483646;display:flex;align-items:center;gap:8px;
 padding:10px 16px;border-radius:12px;border:1px solid var(--cc-accent);background:var(--cc-accent);
 color:var(--cc-accent-ink);cursor:pointer;font:600 13px system-ui,sans-serif;box-shadow:0 4px 20px #0008}
.cc-open:hover{background:var(--cc-accent-hover)}
`;

/** Optional presentation-only styles let the landing highlight the real launch button. */
export function createUi(extraStyles = ''): HTMLElement {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  // Content scripts share the DOM with page scripts. Programmatic clicks/change events must
  // never select conversations or authorize an action, even if a control reference leaks.
  for (const type of ['click', 'change', 'input', 'keydown', 'keyup']) {
    root.addEventListener(type, (event) => {
      if (!event.isTrusted) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true });
  }
  root.innerHTML = `<style>${CSS}${extraStyles}</style><button class="cc-open">Clean up</button>`;

  const selected = new Set<string>();
  /** Identifies this panel as a batch owner, so two tabs cannot run the same work. */
  const ownerId = newOwnerId();
  /**
   * Guards the same page against itself. The lease stops a *different* tab, but closing and
   * reopening the panel reuses this closure and its owner id, so the lease would happily be
   * re-taken and a second worker would run over the first. This outlives an opening because it
   * lives here rather than inside open().
   */
  let batchInFlight = false;
  let inventory: Inventory | null = null;

  const openBtn = root.querySelector('.cc-open') as HTMLButtonElement;
  openBtn.onclick = () => open();

  function open() {
    openBtn.style.display = 'none';
    const el = document.createElement('div');
    el.className = 'cc-root';
    el.innerHTML = `
      <div class="cc-hd"><b>Chat Cleanup</b><button class="cc-x" title="Close">×</button></div>
      <div class="cc-warn" hidden></div>
      <div class="cc-sum">
        <div class="cc-total">Loading…</div>
        <div class="cc-selrow"><span class="cc-sel">0 selected</span>
          <button class="cc-none" disabled>Clear</button><button class="cc-all" disabled>Select all</button></div>
        <div class="cc-rules" aria-label="Select cleanup candidates by rule"></div>
        <div class="cc-note" hidden></div>
      </div>
      <div class="cc-list"></div>
      <div class="cc-ft"><button class="cc-primary" disabled>Archive</button><button disabled>Delete…</button></div>`;
    root.appendChild(el);

    const list = el.querySelector('.cc-list') as HTMLElement;
    const summary = el.querySelector('.cc-sum') as HTMLElement;
    const total = el.querySelector('.cc-total') as HTMLElement;
    const selCount = el.querySelector('.cc-sel') as HTMLElement;
    const note = el.querySelector('.cc-note') as HTMLElement;
    const clearBtn = el.querySelector('.cc-none') as HTMLButtonElement;
    const allBtn = el.querySelector('.cc-all') as HTMLButtonElement;
    const rulesEl = el.querySelector('.cc-rules') as HTMLElement;
    const warn = el.querySelector('.cc-warn') as HTMLElement;
    let [archiveBtn, deleteBtn] = [...el.querySelectorAll('.cc-ft button')] as HTMLButtonElement[];
    let cancelReview: (() => void) | null = null;
    let detachProtectionListener = () => {};
    const closePanel = () => {
      cancelReview?.();
      detachProtectionListener();
      el.remove();
      openBtn.style.display = '';
    };
    (el.querySelector('.cc-x') as HTMLElement).onclick = closePanel;

    let protectedBy = new Map<string, string>();
    let manual = new Set<string>();
    // A previous opening's inventory must not enable actions before this opening's storage
    // and protection reads succeed, especially when a persisted batch fails validation.
    let ready = false;
    /** Row index of the last checkbox the user clicked, within the RENDERED order. */
    let anchor: number | null = null;
    /** Expanded project groups. Collapsed by default: most rows in a project account are
     *  project rows, and an account is easier to read as folders than as one long list. */
    const expanded = new Set<string>();
    /** Exactly the conversations currently drawn, in draw order — what a shift-range spans. */
    let visible: Conversation[] = [];
    let activeRuleKey: string | null = null;

    const conversations = () => inventory?.conversations ?? [];

    /**
     * True while the batch report owns the list area. Any redraw of the list would wipe a
     * report the user has not dismissed yet, so every path checks this one flag.
     */
    let reportOpen = false;
    let reviewing = false;
    const canSelect = () => ready && !reportOpen && !reviewing && !batchInFlight;

    /** Header and project chips. Never touches the list area. */
    const paintSummary = () => {
      total.textContent = plural(conversations().length, 'conversation');
      selCount.textContent = `${selected.size} selected`;
      summary.hidden = reportOpen;
      summary.inert = reportOpen || reviewing;
      clearBtn.disabled = !canSelect() || selected.size === 0;
      allBtn.disabled = !canSelect() || conversations().length === 0;
      paintRules();
    };

    function paintRules() {
      if (!inventory) {
        rulesEl.replaceChildren();
        return;
      }
      const label = document.createElement('span');
      label.className = 'cc-rules-label';
      label.textContent = 'Select:';
      const buttons = allRules.map((rule) => {
        const button = document.createElement('button');
        button.className = 'cc-chip';
        button.type = 'button';
        button.setAttribute('aria-pressed', String(activeRuleKey === rule.key));
        const count = ruleCount(conversations(), rule);
        const short = rule.key === 'age-30' ? '30d+'
          : rule.key === 'age-90' ? '90d+'
            : rule.key === 'age-180' ? '180d+'
              : rule.key === 'age-365' ? '1y+'
                : rule.label;
        button.textContent = short;
        const badge = document.createElement('b');
        badge.textContent = String(count);
        button.append(badge);
        button.title = `Select ${rule.label.toLowerCase()} (protected chats stay unselected)`;
        button.disabled = !canSelect() || count === 0;
        button.onclick = () => applyRule(rule, count);
        return button;
      });
      rulesEl.replaceChildren(label, ...buttons);
    }

    const refreshSummary = () => {
      protectedBy = protectionMap(conversations(), manual);
      paintSummary();
    };

    /** Recomputes protections and redraws everything, list included. */
    const refresh = () => {
      protectedBy = protectionMap(conversations(), manual);
      render();
    };

    // Protection changes made in another ChatGPT tab must be visible before this tab performs
    // another bulk selection. The Web Lock in setProtected prevents cross-tab lost updates;
    // this listener keeps the already-open review list in sync with the durable value.
    const protectionChange = (value: unknown) => {
      if (value !== undefined &&
        (!Array.isArray(value) || value.some((id) => typeof id !== 'string'))) {
        warnStorageLost();
        return;
      }
      manual = new Set(
        Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [],
      );
      if (ready && el.isConnected) refresh();
    };
    /**
     * The extension was reloaded or auto-updated while this tab stayed open, orphaning the
     * content script. Everything that talks to ChatGPT still works — only chrome.* is gone —
     * so say exactly what is lost and what fixes it.
     */
    const warnStorageLost = () => {
      ready = false;
      archiveBtn.disabled = true;
      deleteBtn.disabled = true;
      clearBtn.disabled = true;
      allBtn.disabled = true;
      warn.hidden = false;
      warn.textContent =
        'Local safety state is unavailable, so cleanup has been disabled. Reload the page before ' +
        'selecting, archiving or deleting chats.';
    };

    const setNote = (text: string) => {
      note.hidden = !text;
      note.textContent = text;
    };

    /**
     * Bulk gestures report what they left alone. Silently skipping 27 conversations would
     * look like a bug; saying so turns it into a safety feature the user can see.
     */
    const applyBulk = (r: { ids: string[]; skipped: number }, what: string) => {
      if (!canSelect()) return;
      activeRuleKey = null;
      for (const id of r.ids) selected.add(id);
      setNote(
        `${plural(r.ids.length, 'chat')} selected${what}` +
          (r.skipped ? `\n${plural(r.skipped, 'protected chat')} skipped — tick them by hand to include them` : ''),
      );
      anchor = null;
      render();
    };

    const applyRule = (rule: CleanupRule, matched: number) => {
      if (!canSelect() || !inventory) return;
      const review = reviewSet(conversations(), [rule], manual);
      selected.clear();
      for (const id of review.suggested.keys()) selected.add(id);
      activeRuleKey = rule.key;
      const skipped = matched - review.suggested.size;
      setNote(
        `${plural(review.suggested.size, 'chat')} selected by “${rule.label}”` +
          (skipped ? `\n${plural(skipped, 'protected chat')} skipped` : ''),
      );
      anchor = null;
      render();
    };

    const render = () => {
      if (!inventory || !ready) return;
      paintSummary();
      if (reportOpen) return; // the report is on screen; do not rebuild the list under it
      // A partial read can omit chats, but it cannot retarget the stable IDs already reviewed.
      // The adapter excludes records with conflicting protection metadata before they get here.
      const blocked = selected.size === 0 || !canSelect();
      archiveBtn.disabled = blocked;
      deleteBtn.disabled = blocked;
      archiveBtn.textContent = selected.size ? `Archive ${selected.size}` : 'Archive';
      deleteBtn.textContent = selected.size ? `Delete ${selected.size}…` : 'Delete…';

      // Loose chats first — they are the ordinary cleanup work — then one folder per project.
      const convs = conversations();
      const groups = projectGroups(convs, inventory.projects);
      const inAGroup = new Set(groups.flatMap((g) => g.ids));
      const byId = new Map(convs.map((c) => [c.id, c]));
      const recency = (g: { ids: string[] }) =>
        Math.max(...g.ids.map((id) => byId.get(id)?.updatedAt ?? 0));
      groups.sort((a, b) => recency(b) - recency(a));

      const nodes: HTMLElement[] = [];
      visible = [];

      const emit = (c: Conversation, inGroup: boolean) => {
        const index = visible.length;
        visible.push(c);
        nodes.push(
          row(
            c,
            {
              checked: selected.has(c.id),
              protectedBy: protectedBy.get(c.id),
              manual: manual.has(c.id),
              inGroup,
            },
            (on, shift) => {
              if (!canSelect()) return;
              if (shift && anchor !== null) {
                // The range spans what the user can actually see, not the underlying
                // inventory: with folders collapsed the two orders are different, and a
                // range that swept up hidden rows would be a nasty surprise.
                applyBulk(selectRange(visible, anchor, index, protectedBy), '');
                return;
              }
              on ? selected.add(c.id) : selected.delete(c.id);
              activeRuleKey = null;
              anchor = index;
              setNote('');
              render();
            },
            async () => {
              if (!canSelect()) return;
              const protecting = !manual.has(c.id);
              let r: Awaited<ReturnType<typeof setProtected>>;
              try {
                r = await setProtected(c.id, protecting);
              } catch {
                warnStorageLost();
                return;
              }
              manual = r.ids;
              if (protecting) selected.delete(c.id);
              activeRuleKey = null;
              if (!r.saved) {
                ready = false;
                warnStorageLost();
              }
              refresh();
            },
          ),
        );
      };

      for (const c of convs) if (!inAGroup.has(c.id)) emit(c, false);

      for (const g of groups) {
        const open = expanded.has(g.id);
        const chosenHere = g.ids.filter((id) => selected.has(id)).length;
        nodes.push(
          groupHeader(g, open, chosenHere, () => {
            open ? expanded.delete(g.id) : expanded.add(g.id);
            anchor = null;
            render();
          }, () => {
            if (!canSelect()) return;
            if (chosenHere === g.ids.length) {
              activeRuleKey = null;
              for (const id of g.ids) selected.delete(id);
              setNote(`Deselected ${plural(g.ids.length, 'chat')} in "${g.name}"`);
              anchor = null;
              render();
            } else {
              // Chats in a project are protected, so choosing the folder by name is an
              // explicit override. The confirmation still spells that out before anything runs.
              applyBulk({ ids: g.ids, skipped: 0 }, ` in "${g.name}"`);
            }
          }),
        );
        if (open) for (const id of g.ids) {
          const c = byId.get(id);
          if (c) emit(c, true);
        }
      }

      list.replaceChildren(...nodes);
      if (!convs.length) {
        list.innerHTML = '<div class="cc-empty"><b>You’re all caught up</b>No chats left in this list.</div>';
      }
    };

    allBtn.onclick = () => {
      applyBulk(selectAll(conversations(), protectedBy), '');
    };
    clearBtn.onclick = () => {
      if (!canSelect()) return;
      selected.clear();
      activeRuleKey = null;
      anchor = null;
      setNote('');
      render();
    };

    /**
     * A saved batch we refuse to trust. Never resumed, never silently deleted: the user is
     * told what happened and discards it deliberately.
     */
    function showRejectedBatch(reason: string) {
      warn.hidden = false;
      warn.replaceChildren(
        document.createTextNode(
          `A saved cleanup batch could not be verified and will not be resumed (${reason}) ` +
            'Nothing was changed. Cleanup still works; discard the record to hide this. ',
        ),
      );
      const discard = document.createElement('button');
      discard.textContent = 'Discard saved batch';
      discard.style.cssText =
        'background:none;border:none;color:#ffb782;text-decoration:underline;cursor:pointer;padding:0;font:inherit';
      discard.onclick = async () => {
        if (await clearBatch()) {
          warn.hidden = true;
          warn.textContent = '';
          return;
        }
        // Storage is gone (usually an extension update orphaned this page). Saying "discarded"
        // when the record is still there would be a lie the user discovers on the next open.
        discard.disabled = true;
        discard.textContent = 'Could not discard — reload the page and try again';
      };
      warn.append(discard);
    }

    /**
     * An interrupted batch is never resumed on its own — the user decides. Discarding only
     * forgets the record; it never undoes what already happened.
     */
    const verificationDisclosure =
      'To verify each result, Chat Cleanup downloads that conversation’s detail response from ' +
      'ChatGPT. The response may contain message content; message content is not stored, analyzed ' +
      'or sent to the developer.';

    async function ensureDataConsent(): Promise<'allowed' | 'declined' | 'blocked'> {
      const stored = await readKeyState<unknown>(CONSENT_KEY);
      if (!stored.ok) {
        warnStorageLost();
        return 'blocked';
      }
      if (stored.value === CONSENT_VERSION) return 'allowed';
      const allowed = await confirmDialog(el, {
        title: 'Allow access to your ChatGPT history?',
        body:
          'Chat Cleanup reads conversation titles, dates, pinned/Project status, your ChatGPT ' +
          'account ID and session authentication to show and process your history. It stores ' +
          'protected conversation IDs and unfinished batch titles/IDs in this Chrome profile.\n\n' +
          'Data is sent only to ChatGPT, never to the developer. After you approve a batch, ' +
          'verification may download conversation details containing messages; message content ' +
          'is not stored or analyzed.',
        ok: 'Allow and continue',
        cancel: 'Close',
        danger: false,
      }, (cancel) => { cancelReview = cancel; });
      cancelReview = null;
      if (!allowed || !el.isConnected) return 'declined';
      if (!(await writeKey(CONSENT_KEY, CONSENT_VERSION))) {
        warnStorageLost();
        return 'blocked';
      }
      return 'allowed';
    }

    async function reviewConfirmation(o: {
      title: string;
      body: string;
      ok: string;
      danger: boolean;
      cancel?: string;
      items: string[];
    }): Promise<boolean> {
      if (reviewing || batchInFlight || !el.isConnected) return false;
      reviewing = true;
      summary.inert = true;
      list.inert = true;
      archiveBtn.disabled = true;
      deleteBtn.disabled = true;
      const answer = await confirmDialog(el, o, (cancel) => { cancelReview = cancel; });
      cancelReview = null;
      reviewing = false;
      list.inert = false;
      if (el.isConnected && !reportOpen) render();
      return answer && el.isConnected;
    }

    async function offerResume(b: {
      kind: OpKind;
      startedAt: number;
      accountId: string;
      ops: Operation[];
    }) {
      const left = b.ops.filter((o) => o.state !== 'done' && o.state !== 'failed').length;
      if (left === 0) {
        await clearBatch();
        return;
      }
      if (!inventory || b.accountId !== inventory.accountId) {
        showRejectedBatch('the saved batch belongs to a different ChatGPT account or workspace');
        return;
      }
      const settled = b.ops.length - left;
      const verb = b.kind === 'archive' ? 'archiving' : 'deleting';
      const when = b.startedAt ? ` from ${new Date(b.startedAt).toLocaleString()}` : '';
      const pending = b.ops.filter((o) => o.state !== 'done' && o.state !== 'failed');
      const resume = await reviewConfirmation({
        title: `Resume ${verb} ${plural(left, 'conversation')}?`,
        body:
          `An unfinished batch${when} was interrupted. ` +
          `${settled} of ${b.ops.length} already finished and will not be repeated.\n\n` +
          verificationDisclosure,
        ok: `Resume ${left}`,
        cancel: 'Not now',
        danger: b.kind === 'remove',
        items: pending.map((op) => op.title || op.id),
      });
      if (!resume) {
        // Closing the panel or pressing Escape must never discard recovery state. Offer a
        // separate, explicit action after the user has declined to resume.
        if (el.isConnected) {
          warn.hidden = false;
          warn.replaceChildren(document.createTextNode(
            'The unfinished batch was kept. Reopen the panel to resume it, or discard only its saved recovery record. ',
          ));
          const discard = document.createElement('button');
          discard.textContent = 'Discard saved batch';
          discard.style.cssText =
            'background:none;border:none;color:#ffb782;text-decoration:underline;cursor:pointer;padding:0;font:inherit';
          discard.onclick = async () => {
            if (await clearBatch()) {
              warn.hidden = true;
              warn.textContent = '';
            } else {
              discard.disabled = true;
              discard.textContent = 'Could not discard — reload the page and try again';
            }
          };
          warn.append(discard);
        }
        return;
      }
      await runQueue(
        OperationQueue.restore(b.kind, b.ops, queueDeps(b.kind, b.startedAt, b.accountId)),
        b.kind,
        b.startedAt,
        b.accountId,
      );
    }

    const chosen = () =>
      (inventory?.conversations ?? []).filter((c) => selected.has(c.id))
        .map((c) => ({ id: c.id, title: c.title }));

    /** Appends an explicit warning when the user hand-picked protected conversations. */
    const withOverride = (body: string, picked: { id: string }[]) => {
      const summary = protectionSummary(picked.map((p) => p.id), protectedBy);
      return summary ? `${body}\n\nIncludes protected conversations: ${summary}.` : body;
    };

    async function protectionsStillMatchReview(
      picked: { id: string }[],
      manualAtReview: ReadonlySet<string>,
    ): Promise<boolean> {
      let latest: Set<string>;
      try {
        latest = await loadProtected();
      } catch {
        warnStorageLost();
        return false;
      }
      const newlyProtected = picked.filter((item) =>
        latest.has(item.id) && !manualAtReview.has(item.id));
      manual = latest;
      if (!newlyProtected.length) return true;
      for (const item of newlyProtected) selected.delete(item.id);
      activeRuleKey = null;
      warn.hidden = false;
      warn.textContent =
        `${plural(newlyProtected.length, 'conversation')} became protected while you were ` +
        'reviewing. They were removed from the selection; review the list again.';
      refresh();
      return false;
    }

    archiveBtn.onclick = async () => {
      if (!canSelect() || !inventory) return;
      const picked = chosen();
      if (!picked.length) return;
      const manualAtReview = new Set(manual);
      const yes = await reviewConfirmation({
        title: `Archive ${plural(picked.length, 'conversation')}?`,
        body: withOverride(
          'Archived chats stay in your account and can be restored from ChatGPT settings.\n\n' +
            verificationDisclosure,
          picked,
        ),
        ok: `Archive ${picked.length}`,
        danger: false,
        items: picked.map((item) => item.title || item.id),
      });
      if (yes && await protectionsStillMatchReview(picked, manualAtReview)) {
        await runBatch(picked, 'archive');
      }
    };

    deleteBtn.onclick = async () => {
      if (!canSelect() || !inventory) return;
      const picked = chosen();
      if (!picked.length) return;
      const manualAtReview = new Set(manual);
      const yes = await reviewConfirmation({
        title: `Delete ${plural(picked.length, 'conversation')} permanently?`,
        body: withOverride(
          `Deleted chats cannot be recovered.\n\n${verificationDisclosure}`,
          picked,
        ),
        ok: `Delete ${picked.length}`,
        danger: true,
        items: picked.map((item) => item.title || item.id),
      });
      if (yes && await protectionsStillMatchReview(picked, manualAtReview)) {
        await runBatch(picked, 'remove');
      }
    };

    const restoreList = () => {
      reportOpen = false;
      queueView = null;
      (el.querySelector('.cc-ft') as HTMLElement).innerHTML =
        '<button class="cc-primary" disabled>Archive</button><button disabled>Delete…</button>';
      const [a, d] = [...el.querySelectorAll('.cc-ft button')] as HTMLButtonElement[];
      a.onclick = archiveBtn.onclick;
      d.onclick = deleteBtn.onclick;
      archiveBtn = a;
      deleteBtn = d;
      render();
      if (!allBtn.disabled) allBtn.focus();
      else (el.querySelector('.cc-x') as HTMLButtonElement).focus();
    };

    async function runBatch(picked: { id: string; title: string }[], kind: OpKind) {
      if (!inventory) return;
      const startedAt = Date.now();
      const accountId = inventory.accountId;
      await runQueue(
        new OperationQueue(picked, kind, queueDeps(kind, startedAt, accountId)),
        kind,
        startedAt,
        accountId,
      );
    }

    /** Shared by a fresh batch and a resumed one, so both persist and report identically. */
    async function runQueue(
      queue: OperationQueue,
      kind: OpKind,
      startedAt: number,
      accountId: string,
    ) {
      // One writer at a time across every tab. Two panels running the same restored batch would
      // overwrite each other's progress and could send the same delete twice.
      if (batchInFlight) {
        warn.hidden = false;
        warn.textContent =
          'A cleanup is already running in this tab. Wait for it to finish or stop it first — ' +
          'nothing was started twice.';
        return;
      }
      try {
        await assertAccountContext(accountId);
      } catch {
        warn.hidden = false;
        warn.textContent =
          'The ChatGPT account or workspace changed after review. Reload and review the list ' +
          'again. Nothing was changed.';
        return;
      }
      let leaseBusy = false;
      const locked = await withExclusiveBatchLock(async () => {
        if (!(await acquireLease(ownerId))) {
          leaseBusy = true;
          return;
        }
        batchInFlight = true;
        const heartbeat = setInterval(() => {
          void renewLease(ownerId).then((held) => {
            if (!held) queue.stop(); // someone took over; stop rather than double-write
          });
        }, HEARTBEAT_MS);

        reportOpen = true;
        setNote('');
        anchor = null;
        const view = progressView(el, kind, queue.ops.length, restoreList);
        queueView = view;
        queue.ops.forEach((o) => selected.delete(o.id));
        paintSummary();
        view.onStop(() => queue.stop());
        try {
          await queue.run();
          // Finalize storage while this queue still owns both locks, after every worker/save.
          if (queue.pending === 0) await clearBatch();
          else if (!(await saveBatch({ kind, startedAt, accountId, ops: queue.ops }))) {
            warnStorageLost();
          }
        } catch (err) {
          warn.hidden = false;
          warn.textContent = `Cleanup stopped after an unexpected error: ${String(err)}`;
          await saveBatch({ kind, startedAt, accountId, ops: queue.ops });
        } finally {
          clearInterval(heartbeat);
          await releaseLease(ownerId);
          batchInFlight = false;
        }
        // Leave the report standing until the user dismisses it with "Back to list".
        view.finish(queue.done, queue.failed, queue.haltedBy);
        refreshSummary();
      });
      if (!locked.acquired || leaseBusy) {
        warn.hidden = false;
        warn.textContent =
          'Another ChatGPT tab is already running a cleanup. Finish or stop it there, then ' +
          'reopen this panel. Nothing was changed here.';
      }
    }

    let queueView: { update: (ops: readonly Operation[]) => void } | null = null;

    function queueDeps(kind: OpKind, startedAt: number, accountId: string): QueueDeps {
      return {
        adapter: apiAdapterFor(accountId),
        verify: (id) => verify(id, accountId),
        concurrency: kind === 'remove' ? 2 : 1,
        // Awaited before each write: an intent we could not record is one we could not tell
        // from an unsent write on the next open, and the queue stops rather than risk that.
        persist: (ops: readonly Operation[]) =>
          saveBatch({ kind, startedAt, accountId, ops: [...ops] }),
        onChange: (ops: readonly Operation[]) => {
          queueView?.update(ops);
          // The queue owns ordered persistence; UI writes could overwrite newer snapshots.
        },
        // ChatGPT's sidebar does not react to our writes, so prune the row ourselves —
        // for archive too, since an archived chat no longer belongs in history.
        onSettled: (id: string) => {
          removeRow(id);
          selected.delete(id);
          if (inventory) {
            inventory = { ...inventory, conversations: inventory.conversations.filter((c) => c.id !== id) };
          }
        },
      };
    }

    void (async () => {
      const consent = await ensureDataConsent();
      if (consent === 'declined') closePanel();
      if (consent !== 'allowed') return;
      detachProtectionListener = onKeyChange('protectedChats', protectionChange);
      try {
        const [inv, saved, restored] = await Promise.all([
          listAll((loaded) => {
            total.textContent = `Loading ${loaded} conversations…`;
          }),
          loadProtected(),
          // Settles either way: a record we refuse to trust must not brick the panel.
          loadRestorePoint(),
        ]);
        inventory = inv;
        manual = saved;
        ready = true;
        if (restored.invalid) showRejectedBatch(restored.invalid);
        else if (restored.batch) void offerResume(restored.batch);
        if (!extensionAlive()) warnStorageLost();
        if (!inv.complete) {
          warn.hidden = false;
          warn.textContent =
            `ChatGPT returned a partial list. ${plural(inv.total, 'verified conversation')} ` +
            `loaded; unavailable chats were excluded and cannot be selected. ` +
            inv.issues.join(' ') +
            (inv.unreadProjects.length ? ` Unread: ${inv.unreadProjects.join(', ')}.` : '') +
            ' Close and reopen Chat Cleanup to retry.';
        }
        refresh();
      } catch (err) {
        total.textContent = '';
        warn.hidden = false;
        warn.textContent = `Could not load conversations: ${err}. Are you signed in?`;
      }
    })();
  }

  return host;
}

/**
 * Every reason a conversation is skipped by bulk selection, as a short badge plus the
 * sentence behind it. There are exactly four; anything else would be a bug, so an unknown
 * reason falls back to a visible `protected` rather than disappearing.
 *
 * `locked` deliberately echoes the padlock control that sets it — the earlier `you` named the
 * owner of the decision instead of the state, which told the reader nothing.
 */
const PROTECTION_TAG: Record<string, { tag: string; why: string }> = {
  'in a project': {
    tag: 'project',
    why: 'In a ChatGPT Project. Bulk selection skips it — you can still tick it by hand.',
  },
  pinned: {
    tag: 'pinned',
    why: 'Pinned in ChatGPT. Bulk selection skips it — you can still tick it by hand.',
  },
  'set by you': {
    tag: 'locked',
    why: 'You locked this chat here. Click the padlock to unlock it.',
  },
  'metadata unavailable': {
    tag: 'unverified',
    why: 'ChatGPT did not report whether this chat is pinned or in a Project, so it is skipped to be safe.',
  },
};

function row(
  c: Conversation,
  st: { checked: boolean; protectedBy?: string; manual: boolean; inGroup?: boolean },
  onToggle: (on: boolean, shift: boolean) => void,
  onLock: () => void,
): HTMLElement {
  const el = document.createElement('label');
  el.className =
    (st.protectedBy ? 'cc-row cc-prot' : 'cc-row') + (st.inGroup ? ' cc-in-grp' : '');

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = st.checked;
  // Protected rows stay tickable BY HAND. Protection stops bulk gestures from sweeping a
  // conversation up silently; it is not a lock on the user's own judgement.
  let shiftHeld = false;
  box.onclick = (e) => {
    shiftHeld = (e as MouseEvent).shiftKey;
  };
  box.onchange = () => onToggle(box.checked, shiftHeld);

  const title = document.createElement('span');
  title.className = 'cc-t';
  title.textContent = c.title || '(untitled)';

  const age = document.createElement('span');
  age.className = 'cc-age';
  age.textContent = formatAge(c.updatedAt);

  el.append(box, title);

  // The lock is only meaningful where manual protection is what decides. On a row already
  // protected by its project or its pin, an open padlock reads as "not protected" and
  // contradicts the badge beside it.
  if (st.manual || st.protectedBy === undefined) {
    const lock = document.createElement('button');
    lock.className = 'cc-lock';
    lock.textContent = st.manual ? '🔒' : '🔓';
    lock.title = st.manual ? 'Remove your protection' : 'Protect this conversation';
    lock.setAttribute('aria-pressed', String(st.manual));
    lock.onclick = (e) => {
      e.preventDefault(); // the row is a <label>; do not toggle the checkbox
      onLock();
    };
    el.append(lock);
  }

  // One badge says why a row is skipped by bulk gestures; `archived` is informational.
  // Inside a folder the `project` badge only repeats the heading above it.
  const reason = st.inGroup && st.protectedBy === 'in a project' ? '' : st.protectedBy;
  const badges: { tag: string; why: string }[] = [];
  if (reason) badges.push(PROTECTION_TAG[reason] ?? { tag: 'protected', why: reason });
  if (c.archived) badges.push({ tag: 'archived', why: 'Already archived in ChatGPT.' });
  for (const b of badges) {
    const t = document.createElement('span');
    t.className = 'cc-tag';
    t.textContent = b.tag;
    t.title = b.why; // the badge is short; the sentence is one hover away
    el.append(t);
  }
  el.append(age);
  return el;
}

/**
 * A project rendered as a folder: its name, how many chats it holds, and one control that
 * selects or deselects all of them. Chats in a project are protected, so this is the explicit
 * way to reach them — the confirmation still names the override before anything runs.
 */
function groupHeader(
  g: { id: string; name: string; ids: string[] },
  open: boolean,
  chosen: number,
  onToggle: () => void,
  onSelect: () => void,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cc-grp';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-expanded', String(open));
  el.title = open ? `Collapse "${g.name}"` : `Show the chats in "${g.name}"`;
  el.onclick = onToggle;

  // Drawn with a border rather than a glyph: ▸ renders as a near-invisible speck at this size,
  // so the folder gave no sign of whether it was open.
  const chev = document.createElement('span');
  chev.className = 'cc-grp-chev';

  const name = document.createElement('span');
  name.className = 'cc-grp-name';
  name.textContent = g.name;

  const meta = document.createElement('span');
  meta.className = 'cc-grp-meta';
  meta.textContent =
    `${plural(g.ids.length, 'chat')} · protected` + (chosen ? ` · ${chosen} selected` : '');

  el.append(chev, name, meta);

  if (open) {
    // Only an opened folder offers to select its chats. On a closed one the button made the
    // folder read as a single action, and hid the fact that you can look inside first.
    const act = document.createElement('button');
    const all = chosen === g.ids.length;
    act.textContent = all ? 'Deselect all' : `Select all ${g.ids.length}`;
    act.title = all
      ? `Deselect the chats in "${g.name}"`
      : `Select all ${plural(g.ids.length, 'chat')} in "${g.name}"`;
    act.onclick = (e) => {
      e.stopPropagation(); // the heading toggles the folder; this button does not
      onSelect();
    };
    el.append(act);
  } else {
    const hint = document.createElement('span');
    hint.className = 'cc-grp-hint';
    hint.textContent = 'Show';
    el.append(hint);
  }
  return el;
}

/**
 * In-panel confirmation. Deliberately not window.confirm(): a native dialog blocks the page,
 * and the count has to be readable in the same surface as the list it refers to.
 */
function confirmDialog(
  host: HTMLElement,
  o: {
    title: string;
    body: string;
    ok: string;
    danger: boolean;
    cancel?: string;
    items?: string[];
  },
  onCancelReady?: (cancel: () => void) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const previousFocus = host.getRootNode() instanceof ShadowRoot
      ? (host.getRootNode() as ShadowRoot).activeElement as HTMLElement | null
      : null;
    const dlg = document.createElement('div');
    dlg.className = 'cc-dlg';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.innerHTML = `<div>
      <h3></h3><p></p>
      <div class="cc-dlg-btns">
        <button class="cc-cancel"></button>
        <button class="cc-ok${o.danger ? ' cc-danger' : ''}"></button>
      </div></div>`;
    (dlg.querySelector('h3') as HTMLElement).textContent = o.title;
    (dlg.querySelector('p') as HTMLElement).textContent = o.body;
    (dlg.querySelector('.cc-ok') as HTMLElement).textContent = o.ok;
    (dlg.querySelector('.cc-cancel') as HTMLElement).textContent = o.cancel ?? 'Cancel';
    if (o.items?.length) {
      const items = document.createElement('ol');
      items.className = 'cc-dlg-items';
      items.setAttribute('aria-label', 'Conversations in this batch');
      for (const value of o.items) {
        const item = document.createElement('li');
        item.textContent = value;
        items.append(item);
      }
      dlg.querySelector('p')!.after(items);
    }
    let closed = false;
    const close = (v: boolean) => {
      if (closed) return;
      closed = true;
      dlg.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(v);
    };
    onCancelReady?.(() => close(false));
    (dlg.querySelector('.cc-cancel') as HTMLElement).onclick = () => close(false);
    (dlg.querySelector('.cc-ok') as HTMLElement).onclick = () => close(true);
    dlg.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dlg.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && dlg.getRootNode() instanceof ShadowRoot &&
        (dlg.getRootNode() as ShadowRoot).activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && dlg.getRootNode() instanceof ShadowRoot &&
        (dlg.getRootNode() as ShadowRoot).activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    host.appendChild(dlg);
    (dlg.querySelector('.cc-cancel') as HTMLButtonElement).focus({ preventScroll: true });
  });
}

/** Replaces the list with live batch progress; restores nothing — the caller re-renders. */
function progressView(host: HTMLElement, kind: OpKind, total: number, onBack: () => void) {
  const body = host.querySelector('.cc-list') as HTMLElement;
  const foot = host.querySelector('.cc-ft') as HTMLElement;
  const el = document.createElement('div');
  el.className = 'cc-prog';
  el.innerHTML = `<h3 class="cc-stat" role="status" aria-live="polite" aria-atomic="true"></h3><div class="cc-bar"><i style="width:0"></i></div>
    <div class="cc-fail"></div>`;
  body.replaceChildren(el);
  foot.innerHTML = '<button class="cc-stop">Stop</button>';

  const stat = el.querySelector('.cc-stat') as HTMLElement;
  const bar = el.querySelector('.cc-bar > i') as HTMLElement;
  const fails = el.querySelector('.cc-fail') as HTMLElement;
  const verb = kind === 'archive' ? 'Archiving' : 'Deleting';
  let stopping = false;

  return {
    update(ops: readonly Operation[]) {
      const done = ops.filter((o) => o.state === 'done').length;
      const failed = ops.filter((o) => o.state === 'failed').length;
      const retrying = ops.filter((o) => o.state === 'retry_wait').length;
      stat.textContent =
        `${stopping ? 'Stopping' : verb} ${done + failed}/${total}` +
        (failed ? ` · ${failed} failed` : '') +
        (retrying ? ' · retrying…' : '');
      bar.style.width = `${Math.round(((done + failed) / total) * 100)}%`;
    },
    onStop(fn: () => void) {
      (foot.querySelector('.cc-stop') as HTMLElement).onclick = () => {
        stopping = true;
        fn();
        stat.textContent = 'Stopping after the conversations already in progress…';
        (foot.querySelector('.cc-stop') as HTMLButtonElement).disabled = true;
      };
    },
    finish(
      done: number,
      failed: Operation[],
      haltedBy?: 'rate-limit' | 'signed-out' | 'account-changed' | 'no-durable-state' | null,
    ) {
      const left = Math.max(0, total - done - failed.length);
      const complete = total > 0 && done === total && failed.length === 0 && !haltedBy;
      const pastVerb = kind === 'archive' ? 'archived' : 'deleted';
      const result = document.createElement('div');
      result.className = `cc-result ${complete ? 'cc-success' : 'cc-attention'}`;
      result.innerHTML = `<div class="cc-result-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27"/>
          ${complete ? '<path class="cc-check" d="m20 32 8 8 16-17"/>' : '<path d="M32 20v15m0 9h.01"/>'}
        </svg></div><p class="cc-result-kicker"></p>`;
      (result.querySelector('.cc-result-kicker') as HTMLElement).textContent =
        complete ? 'Cleanup complete' : left || haltedBy ? 'Cleanup paused' : 'Cleanup needs attention';
      stat.textContent = `${plural(done, 'chat')} ${pastVerb}`;
      result.append(stat);
      const copy = document.createElement('p');
      copy.className = 'cc-result-copy';
      copy.textContent = complete
        ? kind === 'archive'
          ? 'You can restore these chats from ChatGPT settings.'
          : 'The selected chats have been permanently deleted.'
        : `${done} of ${total} chats ${pastVerb}.` +
          (failed.length ? ` ${failed.length} failed.` : '') +
          (left ? ` ${left} not processed.` : '');
      result.append(copy);
      el.replaceChildren(result, fails);
      if (haltedBy) {
        // Nothing was lost: the remaining conversations are saved and resumable.
        const halt = document.createElement('div');
        halt.style.color = '#ffb782';
        halt.textContent =
          haltedBy === 'rate-limit'
            ? 'ChatGPT rate-limited the account, so the batch stopped. Nothing was lost — ' +
              'wait a few minutes, reopen this panel and resume.'
            : haltedBy === 'signed-out'
              ? 'Your ChatGPT session ended, so the batch stopped. Reload the page, sign in, ' +
                'then reopen this panel and resume.'
              : haltedBy === 'account-changed'
                ? 'The ChatGPT account or workspace changed, so the batch stopped. Reload the ' +
                  'page and review the saved batch in the original account.'
              : 'Progress could not be saved, so the batch stopped before doing more work. ' +
                'Reload the page and review the saved batch before resuming.';
        el.append(halt);
      }
      fails.replaceChildren(
        ...failed.map((f) => {
          const d = document.createElement('div');
          d.textContent = `${f.title || f.id} — ${f.error ?? 'unknown error'}`;
          return d;
        }),
      );
      fails.hidden = failed.length === 0;
      foot.innerHTML = '<button class="cc-back">Back to list</button>';
      const back = foot.querySelector('.cc-back') as HTMLButtonElement;
      back.onclick = onBack;
      // Stop disappears at completion; keep keyboard navigation inside this panel.
      if (host.isConnected) back.focus({ preventScroll: true });
    },
  };
}
