# Imported Trivia questions

`easy.json`, `medium.json`, and `hard.json` each contain 285 multiple-choice
questions adapted from **Open Trivia Database (Open Trivia DB)** and its
community contributors, operated by **PIXELTAIL GAMES LLC**.

- Source: https://opentdb.com/
- API and licensing statement: https://opentdb.com/api_config.php
- License: **Creative Commons Attribution-ShareAlike 4.0 International**
  (CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/
- Retrieved: September 11, 2026.

These three data files are distributed under CC BY-SA 4.0. The repository's
software license does not replace the license of this imported question data.
Retain this attribution and license notice when redistributing the data or
adaptations, and license adaptations of the data under CC BY-SA 4.0.

Changes from the source: selected multiple-choice questions using the source's
Easy/Medium/Hard labels; decoded Base64 text; normalized whitespace; excluded
duplicate prompts, unclear or dated items, oversized answer labels, and choices
that depend on their display position; corrected selected spelling and wording;
and converted records to `[question, correct, incorrect, incorrect, incorrect]`.
Categories were interleaved to provide a mix of topics. No endorsement by Open
Trivia DB, its contributors, or PIXELTAIL GAMES LLC is implied.

The 15 original questions per difficulty in `../questions.js` are separate from
this import. They precede the imported rows to preserve saved question indices.
