# Ingredient names the taxonomy lacks

`ingredient-names.<language>.json` maps an Open Food Facts ingredient id to the
names it goes by in that language, primary first, then synonyms people search
for:

```json
{ "en:sour-cream": ["сметана"], "en:minced-meat": ["мясной фарш", "фарш"] }
```

`pnpm db:ingredients` reads every such file. The taxonomy's own primary name
always wins: once Open Food Facts has one, the names here only add synonyms.

- **`ru`** covers every imported ingredient the taxonomy had no Russian name for
  (3,260 of about 4,200). Machine translated on 2026-10-01 from the English
  names, with their parents, synonyms and German and French names as context,
  then checked by script (complete, Cyrillic, no stress marks, lowercase) and
  reviewed by hand: a random sample and every entry the translation marked
  uncertain, mostly obscure fish, shellfish and varieties.
- **Edit by hand** where a name is wrong; nothing regenerates these files.

`ingredient-overrides.<language>.json`, in the same shape, holds the few names
that must win over the taxonomy's own, which then becomes a synonym: Open Food
Facts calls buckwheat "ядрица", but people say "гречка". Keep it short, and
prefer contributing a fix to Open Food Facts where the taxonomy is plainly
wrong.

They are derived from the Open Food Facts database, so they are under the same
licence: the Open Database License (ODbL), with the same credit to Open Food
Facts.
