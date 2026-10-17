# Knorvic i18n — Penpot plugin

Switches a Knorvic Penpot file between English (the source) and Spanish.

The translations are stored inside each Penpot file, in the shared plugin data of every text layer
(namespace `knorvic-i18n`). This repository only holds the switching logic and its small UI.

## Install

1. In Penpot, open **Plugins** (`Ctrl+Alt+P`).
2. Paste `https://knorvic.github.io/penpot-i18n/manifest.json` and click **Install**.
3. Open the plugin in a file:
   - **Selected screens**: switches only the screens that contain the selection (instant, good for one flow).
   - **Whole file**: switches every screen (Backoffice Web takes a few minutes).

Switching rewrites the texts for everyone viewing the file. Switch back to English when you are done.

## Data model

| Shape | Key | Value |
| --- | --- | --- |
| Text layer | `src` | English text the translation was made from |
| Text layer | `es` | Spanish text |
| Text layer | `srcSpans` / `esSpans` | JSON paragraphs of style runs, only for multi-style texts |
| Root board | `src` / `es` | Board name (shown in view mode) |
| Text layer | `shown` | Language currently shown when it is not English |

- When switching to Spanish, texts whose English changed after translating are kept in English
  and counted as "changed since translating".
- Edits made while Spanish is shown are saved as the new Spanish text when switching back.
- Texts without `src` are counted as "without translation".
