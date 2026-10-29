# UI / map-label fonts

OWNER: Art Director. Latin subsets (U+0000-00FF plus general punctuation) of two Google Fonts families,
downloaded from fonts.gstatic.com and shipped with the build so the game never depends on a third-party
font request (the single-file build inlines them). Loaded by `src/ui/theme.css` (`@font-face`); render
code may draw map labels and banner text with the same families once `document.fonts.ready` resolves.

| File | Family | Weight / style | Role | License |
|---|---|---|---|---|
| `tiro-devanagari-sanskrit-latin-400.woff2` | Tiro Devanagari Sanskrit | 400 | Display: titles, headings, buttons, names | SIL OFL 1.1 (`OFL-TiroDevanagariSanskrit.txt`) |
| `tiro-devanagari-sanskrit-latin-400-italic.woff2` | Tiro Devanagari Sanskrit | 400 italic | Taglines, quotes, chronicle epigraphs | SIL OFL 1.1 |
| `mukta-latin-400.woff2` | Mukta | 400 | Body text, labels | SIL OFL 1.1 (`OFL-Mukta.txt`) |
| `mukta-latin-600.woff2` | Mukta | 600 | Emphasis, numbers in bars | SIL OFL 1.1 |
| `mukta-latin-700.woff2` | Mukta | 700 | Short caps labels (unit codes) | SIL OFL 1.1 |

Total ~117 KB. Tiro Devanagari Sanskrit (Tiro Typeworks, made for Sanskrit scholarship) gives the display
type a classical Indic voice; Mukta (Ek Type, Mumbai) is a humanist sans with clear figures at 12-16 px on
phones. To add Devanagari glyphs later, add the `devanagari` subset files with a `unicode-range`.
