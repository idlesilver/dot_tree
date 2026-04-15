# dottree

Maintain Tree files with automatic prefixes, syntax highlighting, and folding.

## Features

- Maintain tree prefixes while indenting/outdenting (Tab/Shift+Tab).
- Insert a sibling line with Enter.
- Snippet: type `|` to insert a starter tree.
- Highlight prefixes, folders, files, and comments in `Tree` files.
- Folder lines are detected from tree structure, so a parent item does not need a trailing `/`.
- `#` comments supported (uses theme comment color).
- Folding for subtrees (triangle gutter, like code folding).
- Handles pasted tree output with variable spaces or tabs in prefixes.
- Works in `.tree` files and files whose language mode is `Tree`.

## Quick Start

1. Create a file with the `.tree` extension, or set language mode to `Tree`.
2. Type or paste a tree, then use Tab/Shift+Tab to adjust structure.
3. Use Enter to add a sibling line.
4. Type `|` on an empty line and accept the snippet to insert:

```
./
└── README.md
```

## Example

```
project_root/
├── src
│   └── app/
│       ├── core/
│       └── ui/
└── README.md # note
```

## Commands

- `Dot Tree: Indent (maintain prefixes)`
- `Dot Tree: Outdent (maintain prefixes)`
- `Dot Tree: New Line (same level)`

## Keybindings

- `Tab` / `Shift+Tab`: indent/outdent on tree lines
- `Enter`: insert sibling line on tree lines

## Configuration

- `dottree.style`: `unicode` or `ascii` (default `unicode`)
- `dottree.indentSubtreeOnSingleCursor`: indent/outdent subtree on single cursor (default `true`)

## Highlight Customization

Prefix highlighting comes from TextMate scopes. Folder, file, and comment names also use semantic tokens so folders can be detected from child lines even when they do not end with `/`.

Colors are controlled by the active theme or editor color customizations, not by extension settings.

Use `textMateRules` directly. The generic shortcut fields such as `comments` or `strings` will not target these tree-specific scopes.

- Prefixes: `punctuation.definition.tree`
- Folders: `entity.name.namespace.tree`
- Files: `string.unquoted.filename.tree`
- Comments: `comment.line.number-sign.tree`

Example `settings.json`:

```json
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      {
        "scope": "punctuation.definition.tree",
        "settings": {
          "foreground": "#6b7280"
        }
      },
      {
        "scope": "entity.name.namespace.tree",
        "settings": {
          "foreground": "#f2994a",
          "fontStyle": "bold"
        }
      },
      {
        "scope": "string.unquoted.filename.tree",
        "settings": {
          "foreground": "#e5e7eb"
        }
      },
      {
        "scope": "comment.line.number-sign.tree",
        "settings": {
          "foreground": "#94a3b8",
          "fontStyle": "italic"
        }
      }
    ]
  }
}
```

## License

MIT
