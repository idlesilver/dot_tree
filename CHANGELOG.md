# Changelog

## 0.0.7
- Detect folder lines from tree structure, so parent items no longer need a trailing `/` for folder highlighting.
- Add semantic tokens for folders, files, and comments while keeping existing TextMate scope customizations.
- Treat root lines before a tree block as folders and include them in folding ranges.
- Treat items ending in `/` as folders even when the slash is followed by trailing spaces before a comment or line end.

## 0.0.6
- Change the default unicode output to standard 4-column `tree` formatting, such as `├──` and `│   `.
- Update the starter snippet and README examples to use the same 4-column format.

## 0.0.5
- Support tree prefixes with variable spaces or tabs, including standard `tree` output such as `│   └──`.
- Improve Tree grammar matching for flexible unicode and ascii prefixes.

## 0.0.4
- Document `editor.tokenColorCustomizations.textMateRules` as the supported way to customize tree highlight colors.
- Clarify that tree highlighting is theme-driven through Tree TextMate scopes.

## 0.0.3
- Move tree highlighting to grammar-based scopes for more stable triggering.
- Split line content on Enter when cursor is in the middle of a tree item.

## 0.0.2
- Add icon

## 0.0.1

- Initial release.
- Tree editing helpers (Tab/Shift+Tab/Enter).
- Snippet insertion with `|`.
- Tree highlighting, comments, and folding.
