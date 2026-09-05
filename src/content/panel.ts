import { apiAdapter, listAll, verify, type Inventory } from '../chatgpt/api.ts';
import { removeRow } from '../chatgpt/dom.ts';
import { formatAge } from '../cleanup/age.ts';
import { protectionMap, protectionSummary } from '../cleanup/protections.ts';
import { projectGroups, selectAll, selectRange } from '../cleanup/selection.ts';
import { extensionAlive } from '../storage/local.ts';
import { loadProtected, setProtected } from '../storage/protectedChats.ts';
import { OperationQueue, type OpKind, type Operation } from '../queue/operationQueue.ts';
import { clearBatch, loadBatch, saveBatch } from '../queue/persistence.ts';
import type { Conversation } from '../types/conversation.ts';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Free v1: manual bulk cleanup. The user decides what goes; the product's job is to make
 * choosing and executing that safe, fast and reversible-where-possible.
 *
 * There are deliberately no date filters or suggested-cleanup rules here — deciding *what*
 * to clean is the Pro story, not part of this release. The filtering primitives still live in
 * src/cleanup/filters.ts, unused by this panel, ready for that work.
 *
 * The list is our own panel rather than checkboxes overlaid on ChatGPT's sidebar: the sidebar
 * is a subset of the truth — it omits every conversation inside a project.
 */
const CSS = `
.cc-root{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:420px;max-height:78vh;
 display:flex;flex-direction:column;border-radius:12px;overflow:hidden;
 background:#181818;color:#ececec;border:1px solid #333;box-shadow:0 8px 40px #000a;
 font:13px/1.5 system-ui,-apple-system,sans-serif}
.cc-hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #2c2c2c}
.cc-hd b{flex:1;font-size:14px}
.cc-sum{padding:10px 14px;border-bottom:1px solid #2c2c2c}
.cc-total{font-size:14px}
.cc-selrow{display:flex;align-items:baseline;gap:10px;margin-top:2px}
.cc-sel{flex:1;color:#9b9b9b}
.cc-selrow button{background:none;border:none;color:#7bb0ff;cursor:pointer;padding:0;font:inherit}
.cc-note{margin-top:6px;color:#8b8b8b;font-size:12px;white-space:pre-line}
.cc-projects{padding:8px 14px;border-bottom:1px solid #2c2c2c;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.cc-projects .cc-lbl{width:100%;color:#9b9b9b;font-size:12px;margin-bottom:2px}
.cc-chip{padding:4px 9px;border-radius:999px;border:1px solid #3a3a3a;background:#222;color:#d4d4d4;cursor:pointer;font:12px system-ui,sans-serif}
.cc-chip[aria-pressed="true"]{background:#2f4f43;border-color:#4a8;color:#dff}
.cc-chip:disabled{opacity:.35;cursor:not-allowed}
.cc-chip b{font-weight:600;opacity:.75;margin-left:5px}
.cc-list{overflow:auto;flex:1;min-height:120px}
.cc-lock{background:none;border:none;cursor:pointer;padding:0 2px;font-size:12px;flex:none;opacity:.3}
.cc-lock[aria-pressed="true"]{opacity:1}
.cc-row.cc-prot .cc-t{color:#9b9b9b}
.cc-row{display:flex;gap:10px;align-items:center;padding:8px 14px;cursor:pointer}
.cc-row:hover{background:#232323}
.cc-row input{margin:0;flex:none;cursor:pointer}
.cc-t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-age{color:#8b8b8b;font-variant-numeric:tabular-nums;flex:none}
.cc-tag{font-size:11px;color:#c8a15a;border:1px solid #5a4a2a;border-radius:4px;padding:0 5px;flex:none}
.cc-ft{padding:12px 14px;border-top:1px solid #2c2c2c;display:flex;gap:8px;align-items:center}
.cc-ft button{flex:1;padding:8px;border-radius:8px;border:1px solid #3a3a3a;background:#2a2a2a;color:#ececec;cursor:pointer}
.cc-ft button:disabled{opacity:.45;cursor:not-allowed}
.cc-x{background:none;border:none;color:#9b9b9b;font-size:18px;cursor:pointer;line-height:1}
.cc-warn{padding:8px 14px;background:#3a2418;color:#ffb782;border-bottom:1px solid #533}
.cc-dlg{position:absolute;inset:0;background:#000c;display:flex;align-items:center;justify-content:center;padding:20px}
.cc-dlg>div{background:#1f1f1f;border:1px solid #3a3a3a;border-radius:10px;padding:16px;max-width:330px}
.cc-dlg h3{margin:0 0 8px;font-size:14px}
.cc-dlg p{margin:0 0 14px;color:#b4b4b4;white-space:pre-line}
.cc-dlg .cc-danger{background:#7f1d1d;border-color:#a33}
.cc-dlg-btns{display:flex;gap:8px}
.cc-dlg-btns button{flex:1;padding:8px;border-radius:8px;border:1px solid #3a3a3a;background:#2a2a2a;color:#ececec;cursor:pointer}
.cc-prog{padding:14px;display:flex;flex-direction:column;gap:10px}
.cc-bar{height:6px;border-radius:3px;background:#2c2c2c;overflow:hidden}
.cc-bar>i{display:block;height:100%;background:#4a8;transition:width .2s}
.cc-fail{color:#ff9b9b;font-size:12px;max-height:140px;overflow:auto}
.cc-fail div{padding:2px 0}
.cc-open{position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:10px 16px;border-radius:999px;
 border:1px solid #3a3a3a;background:#181818;color:#ececec;cursor:pointer;font:13px system-ui,sans-serif;
 box-shadow:0 4px 20px #0008}
`;

export function createUi(): HTMLElement {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><button class="cc-open">Clean up</button>`;

  const selected = new Set<string>();
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
          <button class="cc-none" hidden>Clear</button><button class="cc-all">Select all</button></div>
        <div class="cc-note" hidden></div>
      </div>
      <div class="cc-projects" hidden><span class="cc-lbl">Select all chats in a project</span></div>
      <div class="cc-list"></div>
      <div class="cc-ft"><button disabled>Archive</button><button disabled>Delete…</button></div>`;
    root.appendChild(el);

    const list = el.querySelector('.cc-list') as HTMLElement;
    const total = el.querySelector('.cc-total') as HTMLElement;
    const selCount = el.querySelector('.cc-sel') as HTMLElement;
    const note = el.querySelector('.cc-note') as HTMLElement;
    const clearBtn = el.querySelector('.cc-none') as HTMLButtonElement;
    const projectBar = el.querySelector('.cc-projects') as HTMLElement;
    const warn = el.querySelector('.cc-warn') as HTMLElement;
    let [archiveBtn, deleteBtn] = [...el.querySelectorAll('.cc-ft button')] as HTMLButtonElement[];
    (el.querySelector('.cc-x') as HTMLElement).onclick = () => {
      el.remove();
      openBtn.style.display = '';
    };

    let protectedBy = new Map<string, string>();
    let manual = new Set<string>();
    /** Row index of the last checkbox the user clicked, for shift-range selection. */
    let anchor: number | null = null;

    const conversations = () => inventory?.conversations ?? [];

    /**
     * True while the batch report owns the list area. Any redraw of the list would wipe a
     * report the user has not dismissed yet, so every path checks this one flag.
     */
    let reportOpen = false;

    /** Header and project chips. Never touches the list area. */
    const paintSummary = () => {
      total.textContent = plural(conversations().length, 'conversation');
      selCount.textContent = `${selected.size} selected`;
      clearBtn.hidden = selected.size === 0;
      renderProjects();
    };

    const refreshSummary = () => {
      protectedBy = protectionMap(conversations(), manual);
      paintSummary();
    };

    /** Recomputes protections and redraws everything, list included. */
    const refresh = () => {
      protectedBy = protectionMap(conversations(), manual);
      render();
    };

    /**
     * The extension was reloaded or auto-updated while this tab stayed open, orphaning the
     * content script. Everything that talks to ChatGPT still works — only chrome.* is gone —
     * so say exactly what is lost and what fixes it.
     */
    const warnStorageLost = () => {
      warn.hidden = false;
      warn.textContent =
        'The extension was updated, so this page can no longer save protected chats or batch ' +
        'progress. Reload the page to restore it — cleanup itself still works.';
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
      for (const id of r.ids) selected.add(id);
      setNote(
        `${plural(r.ids.length, 'chat')} selected${what}` +
          (r.skipped ? `\n${plural(r.skipped, 'protected chat')} skipped — tick them by hand to include them` : ''),
      );
      anchor = null;
      render();
    };

    const renderProjects = () => {
      const groups = projectGroups(conversations(), inventory?.projects ?? []);
      projectBar.hidden = groups.length === 0;
      projectBar.replaceChildren(projectBar.firstElementChild!);
      for (const g of groups) {
        const b = document.createElement('button');
        b.className = 'cc-chip';
        b.textContent = g.name;
        // Wording is deliberate: this selects the project's conversations. It never touches
        // the project itself, which this extension cannot and must not delete.
        b.title = `Select ${plural(g.ids.length, 'chat')} in "${g.name}"`;
        const n = document.createElement('b');
        n.textContent = String(g.ids.length);
        b.append(n);
        b.onclick = () => {
          const allSelected = g.ids.every((id) => selected.has(id));
          if (allSelected) {
            for (const id of g.ids) selected.delete(id);
            setNote(`Deselected ${plural(g.ids.length, 'chat')} in "${g.name}"`);
            anchor = null;
            render();
          } else {
            // Chats in a project are protected, so this is an explicit override: the user
            // asked for this project by name. The confirm dialog still spells it out.
            applyBulk({ ids: g.ids, skipped: 0 }, ` in "${g.name}"`);
          }
        };
        projectBar.append(b);
      }
    };

    const render = () => {
      if (!inventory) return;
      paintSummary();
      if (reportOpen) return; // the report is on screen; do not rebuild the list under it
      // An incomplete inventory must never drive a bulk action: acting on a partial list is
      // how a cleanup tool deletes the wrong things.
      const blocked = selected.size === 0 || !inventory.complete;
      archiveBtn.disabled = blocked;
      deleteBtn.disabled = blocked;
      archiveBtn.textContent = selected.size ? `Archive ${selected.size}` : 'Archive';
      deleteBtn.textContent = selected.size ? `Delete ${selected.size}…` : 'Delete…';

      const convs = conversations();
      list.replaceChildren(
        ...convs.map((c, index) =>
          row(
            c,
            {
              checked: selected.has(c.id),
              protectedBy: protectedBy.get(c.id),
              manual: manual.has(c.id),
            },
            (on, shift) => {
              if (shift && anchor !== null) {
                // Range select. Protected conversations inside the range are left out —
                // predictable safety beats clever behaviour on a destructive tool.
                const r = selectRange(convs, anchor, index, protectedBy);
                applyBulk(r, '');
                return;
              }
              on ? selected.add(c.id) : selected.delete(c.id);
              anchor = index;
              setNote('');
              render();
            },
            async () => {
              const r = await setProtected(c.id, !manual.has(c.id));
              manual = r.ids;
              if (!r.saved) warnStorageLost();
              refresh(); // protection may change what "select all" would now skip
            },
          ),
        ),
      );
    };

    (el.querySelector('.cc-all') as HTMLElement).onclick = () => {
      applyBulk(selectAll(conversations(), protectedBy), '');
    };
    clearBtn.onclick = () => {
      selected.clear();
      anchor = null;
      setNote('');
      render();
    };

    /**
     * An interrupted batch is never resumed on its own — the user decides. Discarding only
     * forgets the record; it never undoes what already happened.
     */
    async function offerResume(b: { kind: OpKind; startedAt: number; ops: Operation[] }) {
      const left = b.ops.filter((o) => o.state !== 'done' && o.state !== 'failed').length;
      const settled = b.ops.length - left;
      const verb = b.kind === 'archive' ? 'archiving' : 'deleting';
      const when = b.startedAt ? ` from ${new Date(b.startedAt).toLocaleString()}` : '';
      const resume = await confirmDialog(el, {
        title: `Resume ${verb} ${plural(left, 'conversation')}?`,
        body:
          `An unfinished batch${when} was interrupted. ` +
          `${settled} of ${b.ops.length} already finished and will not be repeated.`,
        ok: `Resume ${left}`,
        cancel: 'Discard',
        danger: b.kind === 'remove',
      });
      if (!resume) {
        void clearBatch();
        return;
      }
      await runQueue(
        OperationQueue.restore(b.kind, b.ops, queueDeps(b.kind, b.startedAt)),
        b.kind,
        b.startedAt,
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

    archiveBtn.onclick = () => {
      const picked = chosen();
      confirmDialog(el, {
        title: `Archive ${plural(picked.length, 'conversation')}?`,
        body: withOverride(
          'Archived chats stay in your account and can be restored from ChatGPT settings.',
          picked,
        ),
        ok: `Archive ${picked.length}`,
        danger: false,
      }).then((yes) => {
        if (yes) void runBatch(picked, 'archive');
      });
    };

    deleteBtn.onclick = () => {
      const picked = chosen();
      confirmDialog(el, {
        title: `Delete ${plural(picked.length, 'conversation')} permanently?`,
        body: withOverride('Deleted chats cannot be recovered.', picked),
        ok: `Delete ${picked.length}`,
        danger: true,
      }).then((yes) => {
        if (yes) void runBatch(picked, 'remove');
      });
    };

    const restoreList = () => {
      reportOpen = false;
      (el.querySelector('.cc-ft') as HTMLElement).innerHTML =
        '<button disabled>Archive</button><button disabled>Delete…</button>';
      const [a, d] = [...el.querySelectorAll('.cc-ft button')] as HTMLButtonElement[];
      a.onclick = archiveBtn.onclick;
      d.onclick = deleteBtn.onclick;
      archiveBtn = a;
      deleteBtn = d;
      render();
    };

    async function runBatch(picked: { id: string; title: string }[], kind: OpKind) {
      const startedAt = Date.now();
      await runQueue(new OperationQueue(picked, kind, queueDeps(kind, startedAt)), kind, startedAt);
    }

    /** Shared by a fresh batch and a resumed one, so both persist and report identically. */
    async function runQueue(queue: OperationQueue, kind: OpKind, startedAt: number) {
      const view = progressView(el, kind, queue.ops.length, restoreList);
      reportOpen = true;
      queueView = view;
      queue.ops.forEach((o) => selected.delete(o.id));
      view.onStop(() => queue.stop());
      await queue.run();
      // Keep the record while anything is still pending (the user stopped it); drop it once
      // every operation has settled, so a finished batch can never be resumed by accident.
      if (queue.pending === 0) await clearBatch();
      else if (!(await saveBatch({ kind, startedAt, ops: queue.ops }))) warnStorageLost();
      // Update the counts around the report, but leave the report itself standing: the user
      // has just been told what happened and still has to dismiss it with "Back to list".
      view.finish(queue.done, queue.failed, queue.haltedBy);
      refreshSummary();
    }

    let queueView: { update: (ops: readonly Operation[]) => void } | null = null;

    function queueDeps(kind: OpKind, startedAt: number) {
      return {
        adapter: apiAdapter,
        verify,
        onChange: (ops: readonly Operation[]) => {
          queueView?.update(ops);
          // Written on every transition so a crash mid-batch loses at most one operation's
          // worth of state. Failures here are non-fatal: losing the record costs a resume,
          // not data. saveBatch never throws, so nothing here can break the queue.
          void saveBatch({ kind, startedAt, ops: [...ops] });
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

    void Promise.all([
      listAll((loaded) => {
        total.textContent = `Loading ${loaded} conversations…`;
      }),
      loadProtected(),
      loadBatch(),
    ])
      .then(([inv, saved, unfinished]) => {
        inventory = inv;
        manual = saved;
        if (unfinished) void offerResume(unfinished);
        if (!extensionAlive()) warnStorageLost();
        if (!inv.complete) {
          warn.hidden = false;
          warn.textContent =
            `Could not read the whole account` +
            (inv.unreadProjects.length ? ` (missed: ${inv.unreadProjects.join(', ')})` : '') +
            `. The list is incomplete — reload before acting on it.`;
        }
        refresh();
      })
      .catch((err) => {
        total.textContent = '';
        warn.hidden = false;
        warn.textContent = `Could not load conversations: ${err}. Are you signed in?`;
      });
  }

  return host;
}

/** Short badge for each protection reason. One label, no duplicated prose next to it. */
const PROTECTION_TAG: Record<string, string> = {
  'in a project': 'project',
  pinned: 'pinned',
  'set by you': 'you',
  'metadata unavailable': 'unverified',
};

function row(
  c: Conversation,
  st: { checked: boolean; protectedBy?: string; manual: boolean },
  onToggle: (on: boolean, shift: boolean) => void,
  onLock: () => void,
): HTMLElement {
  const el = document.createElement('label');
  el.className = st.protectedBy ? 'cc-row cc-prot' : 'cc-row';

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
  const tag = st.protectedBy ? (PROTECTION_TAG[st.protectedBy] ?? 'protected') : '';
  for (const label of [tag, c.archived ? 'archived' : '']) {
    if (!label) continue;
    const t = document.createElement('span');
    t.className = 'cc-tag';
    t.textContent = label;
    el.append(t);
  }
  el.append(age);
  return el;
}

/**
 * In-panel confirmation. Deliberately not window.confirm(): a native dialog blocks the page,
 * and the count has to be readable in the same surface as the list it refers to.
 */
function confirmDialog(
  host: HTMLElement,
  o: { title: string; body: string; ok: string; danger: boolean; cancel?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement('div');
    dlg.className = 'cc-dlg';
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
    const close = (v: boolean) => {
      dlg.remove();
      resolve(v);
    };
    (dlg.querySelector('.cc-cancel') as HTMLElement).onclick = () => close(false);
    (dlg.querySelector('.cc-ok') as HTMLElement).onclick = () => close(true);
    host.appendChild(dlg);
  });
}

/** Replaces the list with live batch progress; restores nothing — the caller re-renders. */
function progressView(host: HTMLElement, kind: OpKind, total: number, onBack: () => void) {
  const body = host.querySelector('.cc-list') as HTMLElement;
  const foot = host.querySelector('.cc-ft') as HTMLElement;
  const el = document.createElement('div');
  el.className = 'cc-prog';
  el.innerHTML = `<div class="cc-stat"></div><div class="cc-bar"><i style="width:0"></i></div>
    <div class="cc-fail"></div>`;
  body.replaceChildren(el);
  foot.innerHTML = '<button class="cc-stop">Stop</button>';

  const stat = el.querySelector('.cc-stat') as HTMLElement;
  const bar = el.querySelector('.cc-bar > i') as HTMLElement;
  const fails = el.querySelector('.cc-fail') as HTMLElement;
  const verb = kind === 'archive' ? 'Archiving' : 'Deleting';

  return {
    update(ops: readonly Operation[]) {
      const done = ops.filter((o) => o.state === 'done').length;
      const failed = ops.filter((o) => o.state === 'failed').length;
      const retrying = ops.filter((o) => o.state === 'retry_wait').length;
      stat.textContent =
        `${verb} ${done + failed}/${total}` +
        (failed ? ` · ${failed} failed` : '') +
        (retrying ? ' · retrying…' : '');
      bar.style.width = `${Math.round(((done + failed) / total) * 100)}%`;
    },
    onStop(fn: () => void) {
      (foot.querySelector('.cc-stop') as HTMLElement).onclick = () => {
        fn();
        stat.textContent = 'Stopping after the current conversation…';
      };
    },
    finish(done: number, failed: Operation[], haltedBy?: 'rate-limit' | 'signed-out' | null) {
      // Failures are listed, never silently swallowed.
      stat.textContent = `Done: ${done} ${kind === 'archive' ? 'archived' : 'deleted'}` +
        (failed.length ? `, ${failed.length} failed` : '');
      if (haltedBy) {
        // Nothing was lost: the remaining conversations are saved and resumable.
        const halt = document.createElement('div');
        halt.style.color = '#ffb782';
        halt.textContent =
          haltedBy === 'rate-limit'
            ? 'ChatGPT rate-limited the account, so the batch stopped. Nothing was lost — ' +
              'wait a few minutes, reopen this panel and resume.'
            : 'Your ChatGPT session ended, so the batch stopped. Reload the page, sign in, ' +
              'then reopen this panel and resume.';
        el.append(halt);
      }
      fails.replaceChildren(
        ...failed.map((f) => {
          const d = document.createElement('div');
          d.textContent = `${f.title || f.id} — ${f.error ?? 'unknown error'}`;
          return d;
        }),
      );
      foot.innerHTML = '<button class="cc-back">Back to list</button>';
      (foot.querySelector('.cc-back') as HTMLElement).onclick = onBack;
    },
  };
}
