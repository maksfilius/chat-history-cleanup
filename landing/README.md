# Chat Cleanup — interactive landing

Run `npm run build:landing`, then open `index.html` in a browser. The generated `demo.js`, icons,
and branding copies are ignored by Git because the build reproduces them from checked-in sources.
No server or installation is needed.
The normal `npm run build` also rebuilds the landing so it follows product changes.

## Общий интерфейс с продуктом

Лендинг использует сам `src/content/panel.ts`, а также настоящую логику выбора, защиты,
очереди и восстановления. Отдельной реализации панели и подтверждений в демо больше нет.
На основном экране остаются заголовок и одна подсказка.
Сайдбар: New chat, поиск, один список с короткими названиями и аватар.
В окне списка видно около десяти строк; остальные доступны прокруткой и поиском.
Закреплённые чаты отмечены маленькой иконкой, подробности защиты и проекты видны в панели.

Одинаковы: Select all / Clear, ручной и Shift-выбор, ручная защита, выбор закреплённых
чатов с предупреждением, раскрытие проектов и выбор группы, подтверждения Archive / Delete
внутри панели, последовательная архивация, удаление до двух чатов одновременно, Stop,
сохранённая очередь и Resume / Discard после повторного открытия, результат и Back to list.

## Demo boundaries

- `build.mjs` substitutes only the ChatGPT adapter/DOM and local storage modules for the
  landing bundle. The extension build retains its real integration.
- 30 fictional conversations: 26 ordinary, 2 pinned, 2 in a project. No live account,
  credentials, requests, external assets, analytics or AI inference.
- Request latency is simulated. The actual operation queue still controls sequencing,
  verification, retries, stopping and recovery.
- Demo metadata, protection and batch state use a separate `sessionStorage` namespace,
  with an in-memory fallback when storage is unavailable. Reload recovery works within
  the tab when storage is available. Reset demo clears only this namespace.
- Product panel CSS and copy are shared, including the green accent and the supplied logo.
  The landing launch button adds a pulsing glow. A separate
  decorative Try it annotation and curved arrow point to it from outside its clickable area. The panel width
  is constrained on narrow screens; its controls and behavior match the product.
- The store CTA says the extension is in development until a real store link exists.

## Files

- `index.html` / `styles.css`: the simplified fictional workspace around the product.
- `main.ts`: workspace history, composer and completion updates.
- `environment.ts`: fictional conversation adapter and sidebar updates.
- `storage.ts`: isolated demo storage.
- `build.mjs`: bundles the real product UI with these demo boundaries and rejects live
  API, fetch or Chrome-storage code in the generated output.
- `demo.js`: generated, do not edit directly.
- `icons/`: transparent PNGs copied from `public/icons`, used as favicon fallbacks.
- `branding/`: the master SVG copied from `public/branding`, used as the favicon in both
  color schemes; the 16px PNG favicon comes from the separate 16px-grid drawing. The header, mobile brand, completion view and shared dark panel all use
  the same mark. The page inlines it as a symbol so it also works under `file://`. Clean up,
  the composer and replies have no logo.
  See `../assets/branding/README.md` for the canonical geometry, palette and export command.

## Verification

`npm run test:landing` checks the desktop/mobile flow in a disposable Chrome profile with
networking blocked, including manual/pinned/project protection, Shift selection, exact
confirmation copy and containment, archive/delete, Stop, reload recovery and Back to list.
Screenshots are saved in the temporary profile. Set `CHROME_BIN` for a nondefault location.
