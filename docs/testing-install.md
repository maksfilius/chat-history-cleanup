# Installing the test build

This is a pre-release build, installed by hand. It is not in the Chrome Web Store yet, so
Chrome will not update it automatically — you get a new version by repeating these steps.

## Install

1. Unzip `chat-cleanup.zip` somewhere you will not delete by accident (not Downloads —
   deleting the folder uninstalls the extension).
2. Open `chrome://extensions`.
3. Turn on **Developer mode**, top right.
4. Click **Load unpacked** and select the unzipped folder — the one containing
   `manifest.json`.
5. Open `https://chatgpt.com` and reload the page. A **Clean up** button appears
   bottom right.

Chrome will show a "Disable developer mode extensions" warning on startup. That is normal for
hand-installed extensions and does not mean anything is wrong.

## Before you test

**This deletes conversations permanently.** Deletion in ChatGPT cannot be undone, by us or by
anyone else.

Please start with **Archive** rather than Delete. Archiving is reversible from ChatGPT's own
settings, so you can undo anything you did not mean to do. Only use Delete on chats you are
certain about.

Pinned chats and chats inside Projects are skipped by "Select all" on purpose. You can still
select them by hand; the confirmation will say so.

## What is useful to report

- Anything that looked wrong, confusing, or slower than you expected.
- The number in the header vs. what you actually see in ChatGPT's sidebar — they should match
  once you count the chats inside your Projects too.
- If a batch stops with a rate-limit message: how long you waited before it worked again.
- If the panel ever showed a count you did not trust, say so even if nothing broke. Trusting
  the count is the whole product.

Console errors help: open DevTools on the ChatGPT tab (Cmd+Opt+I / F12), Console tab, and copy
anything red.

## Removing it

`chrome://extensions` → Remove. Nothing is left behind: the extension stores only your
protected-chat list and unfinished batch state, both inside Chrome, both removed with it.
