# Test fixtures (§19)

These let the Direct value formatter (§12), the AI mapper/parser (§18), and the
answer validator (§15) be unit-tested **without** a live Monday board or live
Anthropic call. Tests under `server/src/**/*.test.ts` read them; they require no
network.

> ⚠️ **These are SYNTHETIC but realistic.** Before trusting the GATED live
> phases (Phase 4 Monday write, Phase 5 AI call), replace `board-schema.json`
> with the **actual, unedited** response of
> `boards(ids:[<REAL_BOARD_ID>]){ id name columns{ id title type settings_str } groups{ id title } }`
> run against a real board, and re-derive `expected-column-values.json` from it.
> `settings_str` is preserved verbatim because status/dropdown labels live there.

| File | Purpose |
|---|---|
| `board-schema.json` | Full GraphQL response for a board with one column of each supported type. |
| `expected-column-values.json` | Golden `column_values` payload the Direct formatter is asserted against. |
| `ai-mapping-response.json` | Representative AI tool output + the expected validated/converted result (incl. a dropped unknown column). |
| `sample-submission.json` | A sample public submit (`answers` + a reference to the test file). |
| `files/test.txt` | Small (<100 KB) file for the attachment path. |
