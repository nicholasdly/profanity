# Profanity detection and masking

Research briefing on how to detect and mask profanity in user-written text, written for teams building a fast, general-purpose service that other people's products depend on.

This document is deliberately vendor-neutral and implementation-neutral. It describes what the evidence says, what breaks in production, and which decisions are policy rather than engineering. It does not recommend a specific library or prescribe an architecture.

**Thesis.** Profanity detection is not a weak version of content moderation. It is a different, much easier problem that happens to share vocabulary with harder ones. The effective system is the smallest detector that matches what you actually want to stop. Filters fail in practice for three recurring reasons: they conflate swearing with toxicity and hate speech, they match substrings instead of spans, and they normalize aggressively without measuring what the normalization destroys.

---

## 1. Three tasks wear the same word

"Profanity filter" is used for three tasks with different signals, different error costs, and different correct tools.

| Task                 | Signal lives in                      | Decidable from  | Right tool                |
| -------------------- | ------------------------------------ | --------------- | ------------------------- |
| Profanity / swearing | A closed set of taboo tokens         | The token       | Lexicon + normalization   |
| Toxicity / insult    | Rudeness and targeting               | The sentence    | Classifier with a score   |
| Hate speech          | Identity, intent, history, discourse | Beyond the text | Classifier + human review |

OLID (Zampieri et al., NAACL 2019) formalizes this as a deliberate hierarchy: level A offensive or not; level B targeted insult (TIN) vs. untargeted profanity (UNT); level C target type — individual, group, or other. The hierarchy exists so you do not run the expensive contextual detector until the cheap lexical one has done its job, and so you do not pretend the two are the same job.

In OLID's 14,100 annotated English tweets, untargeted profanity was the smallest offensive bucket: 551 UNT against 4,089 TIN in the training split. Read that carefully, though — OLID was sampled with keyword queries skewed toward political and controversial content, so the ratio describes _that corpus_, not the natural rate of swearing in chat. The safe conclusion is narrower and still useful: general-purpose moderation datasets and the APIs trained on them are dominated by targeted insult, not by swearing. **If your product wants swear-word control, most moderation APIs are solving a different problem.**

Malmasi & Zampieri (JETAI 2018) attacked the separation directly, classifying text as hate speech, general profanity, or neither. With n-grams, skip-grams, word-cluster features, ensembles, and stacked generalization, their best result was **80% accuracy** on that three-way task. Their analysis blames surface features: distinguishing profanity from hate needs "a deeper understanding of the text." That is evidence for keeping these as separate detectors with separate policies, not for building one score that tries to span them.

### What "profanity" should mean here

A closed list of obscene or vulgar tokens, optionally with inflections. No requirement to understand insults, sarcasm, or identity attacks. That constraint is why a well-built word matcher is often **optimal rather than a compromise**.

The major vendors agree with the split even when their customers do not. Perspective exposes `PROFANITY` ("swear words, curse words, or other obscene or profane language") as a _separate attribute_ from `TOXICITY` ("a rude, disrespectful, or unreasonable comment that is likely to make people leave a discussion").

### The structural gap: modern classifiers dropped profanity

Something important has happened to the vendor landscape, and it changes what "just use an API" means.

The current generation of moderation classifiers models **harm**, not **register** — and profanity is a register problem. OpenAI's moderation endpoint has thirteen categories spanning hate, harassment, sexual content, violence, self-harm, and illicit behavior, and **no profanity category at all**. Azure's Content Safety has four — hate, sexual, violence, self-harm — and also none; its predecessor, Content Moderator, _did_ ship a built-in profanity term list, and Microsoft's own migration guidance notes the replacement has no built-in term list and that you must supply your own. Among the large providers, only AWS Comprehend retains an explicit `PROFANITY` label (English only), and among open models only Detoxify keeps an `obscene` class.

The practical consequence is easy to state. "You're a fucking legend, mate" is affectionate. It scores near zero on every harm taxonomy, and it is exactly what a profanity filter is asked to catch. A harm classifier cannot answer "keep swearing out of usernames" or "keep this children's chat clean," because that is not the question it was built to answer.

So the two halves of what people call content moderation have separated. Harm detection has moved to large models. Profanity detection has been left almost entirely to wordlist and pattern matchers — the same technology that has generated the Scunthorpe problem for thirty years, and which very few people have modernized.

---

## 2. Base rates: what the lexicon actually looks like

This is the most actionable fact in the literature and it is almost always omitted from engineering write-ups.

From decades of public-swearing frequency counts (Jay; Jay & Janschewitz):

- Swearing is roughly **0.5–0.7% of spoken word output**.
- Across counts in 1986, 1997, and 2006, more than 70 taboo word _types_ were recorded — but **ten words account for roughly 80% of the data**: _fuck, shit, hell, damn, goddamn, Jesus Christ, ass, bitch, sucks, oh my god_.
- **`fuck` and `shit` alone are one third to one half of all episodes.**
- The top-ten set is essentially unchanged across those thirty years. Highly offensive slurs occur comparatively rarely in public speech.

Four consequences follow directly:

1. **The head is tiny and the tail is long and flat.** A few dozen well-chosen entries capture most real traffic. Each additional entry buys progressively less recall while carrying the same false-positive risk. Large lists are not obviously better lists.
2. **The core vocabulary is stable.** The common claim that "wordlists go stale" is true of slang and coded terms, and largely false of the profanity head. What actually moves is _obfuscation_, not vocabulary — which is a normalization problem, not a list-maintenance problem.
3. **Hits are rare.** Well under 1% of tokens will match. Throughput is therefore dominated by scanning clean text, not by handling matches. Optimize the scan.
4. **Frequency and offensiveness are different axes.** The most frequent words are mild; the most offensive are rare. A single flat list cannot express that, which is the argument for severity tiers.

---

## 3. Lexical vs. statistical: what the measurements say

The best public head-to-head on _profanity specifically_ (as opposed to toxicity or hate) is Soykan, Karsak, Durgar Elkahlout & Aytan (Turkcell), _A Comparison of Machine Learning Techniques for Turkish Profanity Detection_, ResT-UP2 workshop at LREC 2022, on 392,806 labeled search-engine queries.

| Model             | F1       | Precision | Recall |
| ----------------- | -------- | --------- | ------ |
| LinearSVC (tuned) | 0.92     | 0.98      | 0.87   |
| Baseline LSTM     | 0.92     | 0.98      | 0.86   |
| BERT              | **0.93** | 0.96      | 0.90   |
| Electra           | **0.93** | 0.96      | 0.89   |
| T5                | 0.90     | 0.94      | 0.87   |

Inference time for 100 samples averaging 18 characters: LinearSVC 171 ms, LSTM 232 ms, BERT 5.0 s, Electra 5.1 s. **Roughly 29× the latency for one point of F1.**

The authors' own conclusion is the load-bearing part: profanity "is mostly indicated with single words rather than word groups or contextual meaning/clues," so "simple non-sequential, linear algorithms are almost as effective as deep learning networks." Widening the n-gram range from (1,1) to (1,2) did not help, which is the same finding from a different direction. Where transformers did win was on profane words with uncommon suffixes or accidentally joined to a neighbouring word — recall that sub-word tokenization handles, and that a normalizer plus an inflection strategy also covers.

**Carry the caveats.** Turkish is agglutinative and morphologically harder than English. Search queries average three words, so there is less context than in chat — which cuts both ways. The positive class was 16.4%. Transfer the _shape_ of the result (lexical signal dominates; linear ≈ transformer; latency gap is large), not the exact numbers.

One more result from the same paper is worth its own line: the established public Turkish profanity tool scored **0.30 F1** on their test set where their own LinearSVC scored 0.92. An off-the-shelf detector evaluated on someone else's distribution can collapse entirely. This is the strongest available argument for building your own evaluation set before choosing any tool.

**The practical rule: do not start an ML project to detect "fuck."**

---

## 4. Adversarial input is a literature, not a list of tricks

Users who want to evade a filter are not a hypothetical. Two papers should calibrate expectations.

**Hosseini, Kannan, Zhang & Poovendran (2017), _Deceiving Google's Perspective API_.** Inserting a dot between letters, spacing letters out, or misspelling a word consistently pushed toxicity scores down to benign levels. Changing "idiot" to "idiiot" moved a comment from 84% to 20% toxicity. The attack requires no model access and no sophistication.

**Boucher, Shumailov, Anderson & Papernot (2021), _Bad Characters: Imperceptible NLP Attacks_.** Invisible characters, control characters, and homoglyphs produce input perturbations that are imperceptible to human readers but change model output drastically. Their headline example: replacing the Latin `a` in "paypal" with Cyrillic `а` made Google Translate output an unrelated word.

There is a revealing symmetric result. Rodriguez & Rojas-Galeano (2018) characterize the two attack families as _obfuscation_ and _polarity_, and their polarity example is the interesting one: "It's stupid and wrong" scored 89% toxicity, and "It's **not** stupid and wrong" still scored 83%. Negating the sentence barely moved the score. A model that is defeated by a full stop inside a word but unmoved by a grammatical negation is, functionally, reacting to the presence of a token — **it is behaving like an expensive, less predictable lexicon.** That is the clearest argument in the literature for using an actual lexicon when a lexicon is what you need.

Maintainers of ML-based detectors say the same thing about their own products. The documentation for a widely used scikit-learn profanity classifier — a linear SVM over bag-of-words, trained on ~200,000 labeled samples — states plainly that "it has a hard time picking up on less common variants of swear words like _'f4ck you'_ or _'you b1tch'_ because they don't appear often enough in the training corpus." That is the thesis stated by the opposing side: a model learns the orthography it saw, and leet is a combinatorially large space that no corpus covers. A normalizer handles the same cases in one pass, because it works on the transformation rather than on examples of the transformation.

**The inversion that matters.** The folk belief is that a model is more robust than a wordlist because "it handles typos." The evidence says the opposite along this axis: models are robust to _semantic_ variation and fragile to _orthographic_ variation, while a normalizing matcher is fragile semantically and strong orthographically. Adding a classifier does not buy obfuscation resistance. Obfuscation resistance comes from the normalizer, wherever it sits in the stack — which is why the published defenses against these attacks are text-deobfuscation preprocessors bolted in front of the model.

### The obfuscation ladder

Each rung costs precision to climb. Climb only as far as evidence requires.

| Class                    | Example                                 | Countermeasure                      | Risk                                                     |
| ------------------------ | --------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| Case                     | `FuCk`                                  | Case folding                        | Very low                                                 |
| Repetition               | `fuuuuck`, `fffffuck`                   | Collapse character runs             | Low                                                      |
| Interstitial punctuation | `f.u.c.k`, `f-u-c-k`                    | Skip separator characters           | Breaks contractions if done naively                      |
| Segmentation             | `f u c k`                               | Skip whitespace                     | High — creates matches across legitimate word boundaries |
| Symbol substitution      | `f@ck`, `sh!t`, `a$$`                   | Character folding                   | Moderate                                                 |
| Digit substitution       | `b1tch`, `a55`, `sh1t`                  | Character folding                   | Ambiguous: `1` is `i` or `l`; `5` is `s`                 |
| Homoglyph / mixed script | `аss` (Cyrillic а), `fսck` (Armenian ս) | Confusable folding (UTS #39)        | Moderate, and over-inclusive by design                   |
| Compatibility variants   | `ｆｕｃｋ`, `𝐟𝐮𝐜𝐤`                      | NFKC                                | Low                                                      |
| Invisible characters     | `f\u200Buck`                            | Strip default-ignorable code points | Low                                                      |
| Entity / escape encoding | `&#102;uck`                             | Decode before matching              | Depends on whether callers send markup                   |
| Infixing and padding     | `fuxxck`, `f#ck`                        | Fuzzy / edit-distance matching      | Very high — see below                                    |

Fuzzy matching is where cost explodes. Edit distance against short entries is indiscriminate: distance 1 from `ass` includes `as`, `ash`, `add`, `arm`, `ads`. The shorter the entry, the worse the ratio. If fuzzy matching is offered at all, it should be off by default and restricted by minimum term length.

---

## 5. Normalization is a two-sided trade

Everyone knows normalization can manufacture false positives. The less-appreciated half is that it also destroys true positives.

**It manufactures false positives.** A documented case from a widely used TypeScript matcher: its leetspeak transformer maps `$` → `s`, so the LaTeX-ish input `$$3x^2` normalizes to `ssex^2` and matches. The maintainer's own guidance was that the leetspeak transformer "is fairly aggressive, so if you are seeing many false positives in your application, I would just disable it." A companion report in the same tracker covers uppercase `I` versus lowercase `l`.

**It destroys true positives.** In the Turkish study above, adding spell-check normalization _lowered_ LinearSVC F1 from 0.91 to 0.88. The stated cause: "many misspelled profane words in our dataset are incorrectly changed." The normalizer repaired deliberate obfuscation into innocent words and threw away the signal.

Both failure modes come from the same mistake — treating normalization as a completeness ladder where more is better. It is not. It is a set of independent trades.

**Therefore:**

- Every normalization stage is separately toggleable.
- Every stage is justified by a _failing test case_, not by intuition.
- Every stage is measured on both false positives and false negatives before it ships.
- Defaults should be conservative. Aggressive folding is opt-in, and callers who enable it should be told what it costs.

### Order of operations

Order changes results, and getting it wrong produces bugs that look random.

1. **Decode transport encodings** (HTML entities, percent-encoding) — or explicitly refuse to, and document that.
2. **Strip invisible and default-ignorable characters** — zero-width space `U+200B`, ZWNJ `U+200C`, ZWJ `U+200D`, directional marks `U+200E`/`U+200F`, word joiner `U+2060`, soft hyphen `U+00AD`, BOM `U+FEFF`, and the Unicode Tags block `U+E0000`–`U+E007F`. Do this _early_: most regex engines do not classify `U+200B` as whitespace, so any `\s`-based rule silently misses it. Note that ZWJ is load-bearing inside emoji sequences, so strip on the matching copy only.
3. **Unicode normalization** — NFKC folds compatibility variants (fullwidth, mathematical alphanumerics, ligatures) into their plain forms.
4. **Case folding** — full Unicode case folding rather than a naive lowercase. Beware locale-sensitive lowercasing: Turkish maps dotted and dotless `i` differently, so a locale-aware lowercase can corrupt matching for everyone else.
5. **Confusable folding** — only if homoglyph evasion is in scope. See §6.
6. **Collapse repeated characters** — after case folding, so `FFFFuck` and `ffffuck` behave identically.
7. **Skip or remove separators** — the most dangerous stage; see the contraction and compounding traps in §7.

Keep the original string throughout. Match on the transformed copy, report and mask on the original. This requires an index map, which is §6.

---

## 6. Unicode mechanics

This is where most implementations quietly break, and where "it works on my test string" stops being evidence.

### Confusables and UTS #39

Unicode Technical Standard #39 (_Unicode Security Mechanisms_) defines the standard treatment of visually confusable strings. Its `skeleton(X)` transform maps each character through the published confusables table and applies NFD; two strings are confusable if and only if their skeletons are identical.

Two warnings from the standard itself are directly relevant:

- The mapping is transitive by construction, which makes it **deliberately over-inclusive**. It will fold characters you did not intend to fold.
- A skeleton "is intended only for internal use for testing confusability of strings; the resulting text is not suitable for display to users" and "should definitely not be used as a 'normalization'."

That second point is the design constraint: **fold to match, never to store or return.** The user's original bytes are what you mask and what you give back.

UTS #39 also defines mixed-script detection and restriction levels, which are a better-targeted signal than blanket folding: Latin text containing a lone Cyrillic character is suspicious in a way that a fully Cyrillic string is not.

### Code units, code points, and grapheme clusters

Three different notions of "character", and mixing them corrupts output.

- A JavaScript string is a sequence of **UTF-16 code units**. `.length`, `charAt`, and `s[i]` count those. Anything outside the Basic Multilingual Plane — most emoji, many symbols, some CJK — is a surrogate pair: two units for one visual character.
- Iterating with `for...of`, spreading, or `Array.from` yields **code points**. `"💩".length` is `2`, but `[..."💩"]` has length `1`.
- A **grapheme cluster** is what a user calls a character: `é` as `e` + combining acute, a flag as two regional indicators, an emoji family as several code points joined by ZWJ. `Intl.Segmenter` exposes these.

Pick one level, state it in the API contract, and convert at the boundary. Slicing a string at a code-unit index that falls inside a surrogate pair produces a lone surrogate — invalid text that will render as a replacement character or throw somewhere downstream.

### Index mapping is mandatory

Normalization changes length. `fuuuuck` → `fuck` shortens. `f.u.c.k` → `fuck` shortens. NFKC expansion of a ligature lengthens. Matches are found in _normalized_ coordinates and must be applied in _original_ coordinates.

The fix is an index map built during normalization: for each unit of the output, record which input index it came from. Match spans are then translated back before anything is reported or replaced. Without this, masking lands on the wrong characters — and the bug only appears once a user types something that normalizes to a different length, which is exactly the input an evader sends.

**This is the single most common implementation defect in filters that return spans.** A filter that only returns a boolean can hide it; one that masks cannot.

### Word boundaries are not `\b`

Regex `\b` is defined over ASCII word characters and is wrong nearly everywhere else.

- **Chinese, Japanese, Thai, Khmer, and Lao** do not delimit words with spaces. "Whole-word matching" is undefined without a segmenter, so substring matching is the only option — and the false-positive risk is correspondingly higher.
- **German and Finnish compound freely.** `Staatsexamen` (state examination) contains `sex` across the compound seam. This is a documented filter failure, not a contrived example.
- **Turkish and other agglutinative languages** attach long suffix chains, so a stem match must tolerate arbitrary trailing material — which is exactly what makes precision hard.

UAX #29 defines the real segmentation rules; `Intl.Segmenter` implements them. If the service claims to be language-neutral, it should say which of these it actually handles.

---

## 7. False positives: an empirical catalogue

The Scunthorpe problem is not trivia. It is a thirty-year record of the same bug, and it is still occurring.

The name comes from April 1996, when AOL's profanity filter prevented residents of Scunthorpe, North Lincolnshire from creating accounts, because the town's name contains a substring. Google's SafeSearch reproduced it in the early 2000s.

| Date           | Incident                                                                        | Failure class           |
| -------------- | ------------------------------------------------------------------------------- | ----------------------- |
| Jan 1996       | Searches for Super Bowl **XXX** filtered                                        | Substring               |
| Apr 1996       | Scun**thorpe** blocked by AOL                                                   | Substring, place name   |
| Apr 1998       | `shitakemushrooms.com` refused by InterNIC                                      | Substring, loanword     |
| 2000           | `cum.qc.ca`, the Communauté Urbaine de Montréal                                 | Substring, acronym      |
| 2001–02        | Yahoo! Mail replaced `eval`→`review`, producing "medi**review**" for _medieval_ | Blind substitution      |
| Feb 2003       | UK Commons filter blocked emails about the Sexual Offences Bill, and all Welsh  | Topic term              |
| Feb 2004, 2010 | Craig **Cockburn** rejected by Hotmail, later the BBC                           | Substring, surname      |
| Oct 2004       | Horniman Museum email read as "horny man"                                       | Substring               |
| Jul 2008       | Herman I. **Libshitz** refused an address by Verizon                            | Substring, surname      |
| 2008           | Whakatāne, NZ blocked by its own municipal wifi on phonetic grounds             | Phonetic matching       |
| 2010           | Xbox Live banned a player for living in Fort **Gay**, West Virginia             | Whole word, place name  |
| 2010           | _The Beaver_ magazine renamed after 89 years of publication                     | Whole word              |
| 2014           | `VarusExpirationTimer.luaobj` blocked by UK ISP filters                         | Substring in a filename |
| May 2018       | A supermarket refused a "Summa Cum Laude" cake, delivering "Summa --- Laude"    | Substring, Latin        |
| May 2020       | Dominic **Cummings** hashtags could not trend on Twitter                        | Substring, surname      |
| Oct 2020       | A paleontology conference platform blocked "bone", "pubic", and "stream"        | Domain vocabulary       |
| Jan 2021       | Facebook flagged the Plymouth **Hoe** landmark as misogynistic                  | Whole word, place name  |
| Apr 2021       | Facebook removed the official page of **Bitche**, France                        | Substring, place name   |
| Mar 2025       | Reddit automod flagging posts mentioning "Luigi"                                | Event-driven overreach  |
| ongoing        | Penistone, Clitheroe, Lightwater, Cockermouth, Arsenal                          | Substring, place names  |
| ongoing        | `ass`→`butt`: cl**butt**ic, cl**butt**room, **butt**ignment, **buttbutt**inate  | Blind substitution      |

### Two distinct bugs

These get conflated and they need different fixes.

**Detection false positive** (Scunthorpe, Penistone, Staatsexamen): a banned substring matched inside a legitimate token. Fixed with word boundaries where the language has them, and an allowlist where it does not. The allowlist is not a hack — it is the only method that scales, because the set of legitimate words containing a taboo substring is not derivable from the taboo list.

**Blind substitution** (clbuttic, medireview, "Tyson Homosexual"): the system performed search-and-replace on a substring without regard to token boundaries, silently corrupting correct text. This is strictly worse than a detection false positive, because it damages content rather than blocking it, and it happens even when detection was arguably correct.

**Rule: detect spans, replace only whole spans, never splice inside a larger token.**

### Traps worth naming individually

- **Contractions.** Stripping apostrophes to defeat `f'uck` also turns `he'll` into `hell`, `don't` into `dont`, and `it's` into `its`. Strip interstitial punctuation, but preserve English contraction suffixes.
- **Latin and academic vocabulary.** `cum laude`, `magna cum laude`, `summa cum laude`, `circum-`, `cumulative`.
- **Domain vocabulary.** Anatomy, ornithology, geology, and cooking all contain terms that a naive list flags. The paleontology incident is the canonical case.
- **Mathematical and code input.** `$$`, `a$$ets`, hex strings, base64. Leet folding turns these into words.
- **Proper nouns.** Place names and surnames are the single largest documented category, and blocking a person's own name is the highest-severity false positive there is.

---

## 8. Matching engines

| Approach                        | Complexity                 | Notes                                                                                          |
| ------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `includes()` per term           | O(n·m)                     | No boundaries, no spans. The naive failure.                                                    |
| Hash set over whitespace tokens | O(n)                       | Fast and precise; cannot handle phrases, embedded obfuscation, or languages without spaces.    |
| Regex alternation               | Engine-dependent           | Convenient below a few hundred patterns; degrades unpredictably above, and carries ReDoS risk. |
| Trie                            | O(n · maxDepth) worst case | Simple; restarts scanning on mismatch.                                                         |
| Aho–Corasick                    | O(n + m + z)               | One pass finds every pattern and every overlap; search time is independent of dictionary size. |

Published benchmarks put the crossover where an automaton decisively beats compiled regex alternation at roughly 200–500 patterns; beyond about 1,000 patterns the automaton is reported at 10–100× faster and scales independently of keyword count. Construction cost is milliseconds even at 10,000 entries and is paid once at startup.

### ReDoS: the argument that is usually missed

For a _public_ service, the strongest argument against regex is not speed. It is that backtracking regex engines — JavaScript, Java, Python, Ruby, .NET — have worst-case exponential behavior on crafted input. Regular expression denial of service is a documented, exploited class: OWASP tracks it, and it has caused production outages at Stack Overflow (2016) and Cloudflare (2019).

A profanity service is a near-perfect setup for it: attacker-controlled text of arbitrary shape, flowing into a pattern that was _dynamically assembled from a wordlist_, where nobody audited the resulting expression for nested quantifiers or ambiguous alternation. An automaton has no backtracking, so it has no catastrophic case. That is a security property, not a micro-optimization.

Regardless of engine: **cap input length.** It bounds worst-case latency, worst-case memory, and the blast radius of any pattern mistake.

### Practical properties to preserve

- **Build once, share forever.** The automaton is immutable; construct it at process start.
- **Report overlaps; resolve them above.** If `hers` contains `her`, a complete matcher returns both. Deciding which one wins — longest match, leftmost, allowlist-suppressed — is policy. Burying that decision inside the matcher makes it untunable.
- **Return spans from the engine, not booleans.** Everything downstream (masking, severity, explanation, allowlist suppression) needs positions.

---

## 9. Masking

Masking deserves as much design attention as detection, because it is the part users see.

### Span semantics

Replace the whole matched span. If a blocked match sits entirely inside an allowlisted match, drop it. If two blocked matches overlap, merge before replacing — otherwise the second replacement is computed against offsets the first one already invalidated.

### Styles

| Style                    | Example                                | Property                                                   |
| ------------------------ | -------------------------------------- | ---------------------------------------------------------- |
| Length-matched mask      | `shit` → `****`, `fucking` → `*******` | Preserves layout and sentence rhythm; leaks word length    |
| Fixed-length mask        | any → `****`                           | Hides length; disturbs layout                              |
| Partial / first-and-last | `f**k`, `s**t`                         | Signals what was removed; arguably still legible profanity |
| Grawlix                  | `$#@!`                                 | Comic-strip convention; playful register                   |
| Fixed token              | `[removed]`                            | Formal register; changes length substantially              |
| Deletion                 | ``                                     | Breaks sentence structure and can change meaning           |

Length-matched asterisks are the common default because they preserve surrounding structure while hiding the word. That default is not obviously right for short strings — see below.

### Non-obvious concerns

- **Length leakage.** With a small lexicon, preserving length narrows the candidate set sharply. `****` after "you are a" is not much of a mask. For usernames and other short fields, length preservation approaches no masking at all.
- **Idempotency.** Masking already-masked text should be a no-op. But `f**k` is itself an obfuscation pattern, so a filter with symbol folding enabled can re-detect its own output and mask the mask. Test the round trip explicitly.
- **Cluster safety.** A replacement range must not split a surrogate pair, a combining sequence, or an emoji ZWJ sequence. This is where the code-unit/code-point/grapheme distinction stops being pedantic.
- **Bidirectional text.** Replacing a span inside right-to-left text can reorder what the reader sees.
- **Which string do the offsets index?** If a response contains both masked text and match spans, and the mask changed length, the spans are ambiguous. Say which string they refer to, and prefer masks that preserve length if you return both.
- **Masking is lossy and irreversible.** Callers who need the original must keep it. Say so.

---

## 10. Designing this as a public API

For a general-purpose service, the output contract matters more than the matching algorithm.

**Return spans, not verdicts.** A boolean imposes the service's policy on every caller. A structured hit — position, matched term, severity, which list it came from — lets one caller block, another mask, and a third show a warning, all from one call.

This is rarer than it should be, and the scarcity is worth dwelling on because it is the clearest gap in the field. A survey of the major moderation services and the most-downloaded open-source filters (August 2026) found that **almost none return character offsets.** Most libraries return a boolean, a masked string, or a list of matched words; most services return a document-level or sentence-level score. For the network classifiers this is not an oversight but an inherent property — they _classify_, they do not _locate_, and a model that emits one probability for a passage has no offsets to give.

Returning a masked string looks like a substitute and is not. Once the matcher has normalized the text before matching, the caller cannot reliably recover positions from the output — and that is precisely the case where obfuscation was present, which is exactly when positions matter most. A service that solves the offset-mapping problem internally (§6) and exposes the result is doing the part that is genuinely hard and rarely done.

**Separate detection from action.** "Where is the profanity" and "what should happen" are different questions. Services that only answer the second are unusable by anyone whose policy differs.

**Version the lexicon separately from the API.** A wordlist edit is a behavior change for every existing caller and will break their tests without any version bump on your side. Return the list version in the response so a caller can pin, diff, and reproduce.

**Be deterministic.** Same input plus same configuration plus same list version must yield the same output, byte for byte. This is what makes the service testable by its consumers, and it is trivially achievable for a lexical matcher — an advantage worth advertising over model-backed alternatives.

**Be stateless.** Detection is a pure function of text and configuration. That makes it horizontally scalable without coordination and cacheable by content hash.

**Set explicit limits.** Maximum input size, maximum number of returned matches. Both bound worst-case latency and memory, and both blunt denial of service. Document them and return a structured error rather than truncating silently.

**Do not log request bodies by default.** The payload is user-generated content and frequently private communication. Log a hash and metadata. For a service competing against network classifiers, "your text is not retained" is a real differentiator — the standard objection to hosted moderation is precisely that text leaves the caller's infrastructure.

**Know where the time actually goes.** Published order-of-magnitude figures for a single-stage pattern matcher are around 0.2 ms for an Aho–Corasick pass and 0.5 ms for regex, against 30–50 ms for a CPU transformer; independently, the Turkish study measured about 1.7 ms per sample for a linear model against 50 ms for BERT. Treat all of these as scale indicators rather than benchmarks — they come from different hardware, corpora, and workloads. The engineering point survives the imprecision: **once the matcher is an automaton, it is no longer the bottleneck.** For a hosted API, network round trip and JSON serialization dominate a sub-millisecond match by two orders of magnitude. Optimize end to end, and measure before tuning the matcher further.

**If scope ever grows, cascade rather than replace.** High-confidence lexical hit → act immediately. High-confidence clean → pass. Ambiguous → second-stage scorer or human. Thresholds encode how bad a false block is relative to a miss, and they belong to the policy layer.

**If scores are ever returned, be precise about what they mean.** Perspective's documentation is explicit that its numbers are probabilities of _rater agreement_, not severity: "a comment with a TOXICITY score of 0.9 is not necessarily more toxic than a comment with a TOXICITY score of 0.7. Rather, it's more likely to be perceived as toxic by more readers." Presenting a probability as a severity is a documentation bug that becomes a customer bug.

---

## 11. Evaluation

### Functional tests beat aggregate F1

HateCheck (Röttger et al., ACL 2021) is the methodology worth borrowing even though its subject is hate speech. Instead of one held-out test set, it defines 29 model functionalities with 3,728 validated cases, deliberately pairing each hateful case with **non-hateful contrasts** — reclaimed slurs, negated hate, counter-speech, quoted abuse. The rationale is that held-out accuracy hides specific weaknesses and overstates generalization.

Their result generalizes past their domain: every model they tested, including two commercial services, was "overly sensitive to specific keywords" and misclassified negated and quoted content. A profanity matcher has exactly this failure mode by construction, so it should be tested exactly this way.

### A functional suite for profanity

Paired must-fire and must-not-fire buckets, scored separately.

| Bucket                                                        | Expected                | Why it exists                         |
| ------------------------------------------------------------- | ----------------------- | ------------------------------------- |
| Plain swears, mixed case                                      | Fire                    | Baseline recall                       |
| Inflections (`-ing`, `-er`, plurals)                          | Policy                  | Forces the stem-vs-enumerate decision |
| Repetition, interstitial punctuation                          | Fire                    | Minimum obfuscation bar               |
| Spacing and segmentation                                      | Policy                  | High false-positive cost              |
| Leet and digit substitution                                   | Policy                  | Toggle-dependent                      |
| Homoglyph, zero-width, fullwidth                              | Policy                  | Hostile evasion tier                  |
| Place names and surnames                                      | Not fire                | Highest-severity false positive       |
| Loanwords (`shiitake`, `Penistone`)                           | Not fire                | Documented incidents                  |
| Latin / academic (`cum laude`)                                | Not fire                | Documented incidents                  |
| Domain vocabulary (`bone`, `pubic`, `cockpit`, `shuttlecock`) | Not fire                | Documented incidents                  |
| Contractions (`he'll`, `don't`, `it's`)                       | Not fire                | Punctuation-stripping artifact        |
| Math and code (`$$3x^2`, hex, base64)                         | Not fire                | Leet over-folding                     |
| Compounds (`Staatsexamen`, `assistant`, `classic`)            | Not fire                | Boundary and substitution failures    |
| Already-masked text (`f**k`)                                  | Policy                  | Idempotency                           |
| Emoji, CJK, RTL, astral, empty, whitespace-only               | No crash, no corruption | Input hygiene                         |
| Very long input, many matches                                 | Bounded latency         | Denial of service                     |

**Report per bucket, never as one number.** With a positive rate under 1%, aggregate F1 is dominated by the negative class and conceals exactly the failures that generate support tickets. A filter with 0.99 aggregate accuracy that blocks a town's name is a broken product.

### Choose the metric that matches the action

| Action on a hit  | Optimize for      | Because                                                |
| ---------------- | ----------------- | ------------------------------------------------------ |
| Block submission | Precision         | A false positive is a user who cannot participate      |
| Flag for review  | Recall            | Ambiguity has a human backstop                         |
| Mask in place    | Precision-leaning | A false positive visibly corrupts the user's own words |
| Score only       | Calibration       | The caller sets the threshold                          |

### Distrust vendor benchmarks

Published library shootouts are usually authored by one of the entrants and won by the author. One such comparison of Node.js filters against a 60-case obfuscation set is worth reading for its _shape_ rather than its ranking:

- Naive libraries collapse against obfuscation — around 21% and 37% recall for two of the most-downloaded packages. Any user with basic evasion awareness defeats them.
- Even the best entrant reached only about 67% recall on that set. Nobody has solved obfuscation.
- The strongest competitor fired a false positive on "Penistone," a real UK town — thirty years after Scunthorpe.

Use these as a warning about the state of the art, not as a procurement decision. Score candidates on _your_ fixtures.

---

## 12. Lexicon sourcing and policy

**Sourcing.** The most widely reused open list is LDNOOBW (_List of Dirty, Naughty, Obscene and Otherwise Bad Words_), originally compiled by Shutterstock, covering roughly 28 languages with about 403 English entries, licensed **CC BY 4.0** — attribution is required if you use it.

**Its stated criterion is not yours.** Its README says the question they asked was "what wouldn't we want to _suggest_ that people look at?" That is an autocomplete-suppression criterion, deliberately over-inclusive, designed for a search box. Reusing it as a block list silently imports a policy nobody chose. The maintainers say as much: "what goes in these lists is subjective."

**Flat lists cannot express severity.** Public lists mix mild expletives, hard obscenity, sexual anatomy, drug slang, and identity slurs into one file. Flattening those makes tiering impossible, and tiering is what lets one caller mask `damn` while another does not.

### Slurs are a different product

Identity slurs should not be silently folded into "profanity." The research is unambiguous that token matching cannot make the distinctions that matter:

- **Kurrek, Saleem & Ruths (ALW 2020)** built a taxonomy of 4 categories and 12 subcategories of slur usage across 39,800 annotated Reddit comments — derogatory, appropriative (reclamation), non-derogatory non-appropriative (referential discussion, counter-speech, sarcasm), and a fourth identified by open coding. A matcher sees the same token in all of them.
- **Dixon et al. (AIES 2018)** showed identity terms become false-positive triggers because they are over-represented in toxic training data, and introduced balancing and per-subgroup metrics as the mitigation.
- **Sap et al. (ACL 2019)** found tweets in African American English are up to **twice** as likely to be labeled offensive, and that models trained on those corpora inherit and propagate the bias.
- **"Lost in Moderation" (CHI 2025)**, auditing five commercial moderation APIs across five million queries, found all providers under-moderate implicit hate while over-moderating counter-speech, reclaimed slurs, and content about Black, LGBTQIA+, Jewish, and Muslim people.

Practical consequence: keep slurs on a separate list with a separate default, document the choice, and do not claim the system understands reclamation, quotation, or counter-speech. It does not.

---

## 13. Decision guide

Recommendations change with three questions. Answer them before comparing tools.

### What are you detecting?

| Scope                  | Approach                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Swearing only**      | Local normalized matcher over a curated list. Precision-first if the action is a block. Do not start with a model.                                                                                                                    |
| **Toxicity / insults** | A second detector with a score, cascaded behind the lexical stage. Thresholds are policy, not severity.                                                                                                                               |
| **Hate / slurs**       | Do not start from a wordlist. Wordlists catch some slurs, miss coded and implicit attacks, and over-block reclaimed, quoted, and counter-speech. Classifier plus human review; a small high-precision slur list only as a first pass. |

### What happens on a hit?

| Action            | Consequence for the matcher                                                   |
| ----------------- | ----------------------------------------------------------------------------- |
| Block submission  | Optimize precision. False positives are the product bug.                      |
| Flag for review   | More recall is affordable; ambiguity has a queue.                             |
| Mask in place     | Mask whole spans. Never splice a replacement inside a larger word.            |
| Return spans only | Neutral — the caller decides. The best default for a general-purpose service. |

### Where does the text live?

| Surface               | Bias                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Names and handles     | Precision-first. Strong allowlist. Skip aggressive folding. A blocked name is a lost user.                 |
| Short chat            | Expect obfuscation. Normalize punctuation and repetition. Mask whole tokens.                               |
| Long-form comments    | As chat, plus: bound input size, and expect quoted and reported speech that a lexical filter cannot judge. |
| Search queries        | Very little context; lexical signal dominates.                                                             |
| Code, markup, or math | Disable symbol folding, or expect `$$` to become `ss`.                                                     |

---

## 14. Deliberately out of scope

Image, audio, and video moderation; LLM-as-judge; training a classifier; multilingual morphology beyond a stated language set; intent, sarcasm, and irony detection; spam and scam detection; CSAM and other mandatory-reporting categories, which invert every precision/recall tradeoff described here and carry legal obligations this document does not address.

Each is a different product with different error costs. They belong on the roadmap only when an evaluation set proves the lexical stage is the bottleneck — not when the system merely feels incomplete.

---

## 15. Summary

1. Scope to swearing. Do not ship one number that mixes profanity, toxicity, and hate; the research says even dedicated classifiers separate them at only ~80% accuracy. Note that the large-model APIs have gone the other way and dropped profanity as a category entirely, so "just call a moderation API" no longer answers this question.
2. Curate a small, tiered, owned lexicon. Ten words carry ~80% of real usage, and the core has been stable for thirty years.
3. Match with an automaton. Linear in input, independent of list size, and free of the ReDoS surface that a dynamically assembled regex creates in a public service.
4. Treat normalization as a two-sided trade. Every stage is toggleable, justified by a failing test, and measured on both false positives and false negatives.
5. Maintain an allowlist. It is the only method that scales against Scunthorpe, because the set of legitimate words containing a taboo substring is not derivable from the taboo list.
6. Keep an index map so matches found in normalized space map back to original offsets. This is the most common defect in span-returning filters.
7. Return spans and let the caller choose the action. Almost nothing else does — classifiers score, they do not locate, and a masked string is not a substitute once the matcher has normalized the input.
8. Mask whole spans only. Never splice inside a token — that is a content-corruption bug, not a moderation bug.
9. Version the lexicon and keep output deterministic.
10. Evaluate with paired must-fire and must-not-fire buckets, reported per bucket. Distrust any benchmark published by one of its entrants.

---

## Appendix: landscape snapshot, August 2026

Everything above is intended to age well. This section is not. It is a dated snapshot, included because the field is unusually disrupted right now and because several widely repeated recommendations are already wrong.

### The most-cited free option is being switched off

**Google Jigsaw's Perspective API shuts down on 31 December 2026.** This is a first-party announcement, not a rumor — it appears on Perspective's own site and developer FAQ:

> "The API will no longer be in service after 2026, and we will not be offering direct migration support."

Jigsaw's stated reason is that "AI capabilities have evolved, and there is now less demand for a standalone tool specific to this area." Requests for usage and quota increases closed in February 2026, so a project starting now cannot rise above the default quota of **1 query per second** — enough for development, not for production.

This matters beyond one vendor. Perspective is the most-cited moderation API in the academic literature, the source of the Jigsaw datasets that a large share of toxicity research is trained and benchmarked on, and the lineage behind several open models. A great deal of published guidance — including guidance written recently — recommends an API that will not exist. Treat any Perspective-based recommendation dated before 2026 as expired, while noting that its _documentation_ remains an unusually clear statement of what a probability score does and does not mean, which is why it is still cited above.

Microsoft's Azure Content Moderator is separately scheduled to retire in **March 2027**, and its replacement dropped the built-in profanity term list.

### What this implies

Two of the most established general-purpose moderation services are disappearing within roughly a year of each other, while the surviving large-model APIs have no profanity category at all. Anyone shopping for a hosted profanity filter in 2026 finds a genuinely thin market — which is context worth having, both for build-versus-buy reasoning and for interpreting the confident recommendations in older write-ups.

### Standing caveats when evaluating tools

Beyond the benchmark-authorship problem covered in §11:

- Several of the most-downloaded packages in this space have had no release in five years or more. Download volume measures inertia, not health — check the last publish date, not the badge.
- At least one widely used library's own README advises against installing its latest version.
- Licenses vary more than expected: common wordlists are CC BY 4.0 (attribution required) and at least one well-known filter library is GPL-3.0+. Check before embedding either into a commercial service.

---

## Sources

**Taxonomy and task separation**

- Zampieri, Malmasi, Nakov, Rosenthal, Farra & Kumar, "Predicting the Type and Target of Offensive Posts in Social Media" (OLID), NAACL 2019 — the OFF/TIN/UNT/IND/GRP/OTH hierarchy and label counts.
- Malmasi & Zampieri, "Challenges in Discriminating Profanity from Hate Speech," _Journal of Experimental & Theoretical AI_ 30(2), 2018 — 80% best accuracy on the three-way task.
- Jigsaw Perspective API documentation — `PROFANITY` vs. `TOXICITY` as separate attributes; scores are probabilities of rater agreement, not severity. Note the service sunsets 31 December 2026 (see appendix).
- OpenAI moderation documentation (13 harm categories, no profanity category); Azure AI Content Safety documentation (4 harm categories, no built-in term list); AWS Comprehend `DetectToxicContent` (the one large-provider API retaining an explicit `PROFANITY` label, English only).

**Lexical vs. statistical**

- Soykan, Karsak, Durgar Elkahlout & Aytan, "A Comparison of Machine Learning Techniques for Turkish Profanity Detection," ResT-UP2 @ LREC 2022 — LinearSVC 0.92 F1 vs. BERT/Electra 0.93; ~29× latency gap; normalization lowering F1 from 0.91 to 0.88; lexical dominance over n-grams.

**Frequency and base rates**

- Jay & Janschewitz, "The Science of Swearing," _Observer_ (APS) — swearing at ~0.5% of daily word output, drawn from a pool of ~10 expressions.
- Jay, "The Utility and Ubiquity of Taboo Words," _Perspectives on Psychological Science_ — top ten words ≈80% of recorded episodes; `fuck` and `shit` one third to one half; stability across 1986/1997/2006.

**Adversarial input**

- Hosseini, Kannan, Zhang & Poovendran, "Deceiving Google's Perspective API Built for Detecting Toxic Comments," arXiv:1702.08138, 2017 — "idiot" → "idiiot" drops toxicity from 84% to 20%.
- Boucher, Shumailov, Anderson & Papernot, "Bad Characters: Imperceptible NLP Attacks," arXiv:2106.09898, 2021 — invisible characters, control characters, homoglyphs.
- Rodriguez & Rojas-Galeano, "Shielding Google's language toxicity model against adversarial attacks," arXiv:1801.01828, 2018 — the obfuscation/polarity attack characterization, the negation result, and deobfuscation preprocessing as the defense (at roughly twice the processing time).
- `alt-profanity-check` documentation — a maintained linear-SVM profanity classifier whose own caveats section states it "has a hard time picking up on less common variants of swear words like _'f4ck you'_ or _'you b1tch'_ because they don't appear often enough in the training corpus."

**Unicode**

- Unicode Technical Standard #39, _Unicode Security Mechanisms_ — `skeleton()`, the confusables table, mixed-script and restriction-level detection, and the explicit warning that skeletons are not a normalization and are unsuitable for display.
- Unicode Standard Annex #29, _Text Segmentation_ — grapheme cluster and word boundary rules.

**False positives**

- Wikipedia, "Scunthorpe problem" — the incident catalogue, with primary citations to _The Risks Digest_ (1996), CNET, BBC News, _The Guardian_, _The Telegraph_, _The Washington Post_, and _The Verge_.
- Public issue tracker of a widely used TypeScript matcher — leetspeak `$`→`s` turning `$$3x^2` into a match; maintainer guidance to disable the transformer when false positives appear.

**Matching and performance**

- Aho & Corasick, "Efficient String Matching: An Aid to Bibliographic Search," _CACM_ 18(6), 1975.
- OWASP, "Regular expression Denial of Service (ReDoS)"; and the ReDoS systematization of knowledge, arXiv:2406.11618, for the Stack Overflow (2016) and Cloudflare (2019) outages.
- Published multi-pattern matching benchmarks placing the Aho–Corasick/regex crossover at roughly 200–500 patterns.
- `checkstream-classifiers` crate documentation for order-of-magnitude stage latencies (~0.2 ms Aho–Corasick, ~0.5 ms regex, 30–50 ms CPU transformer). Self-reported by a single vendor on an early release; treat as a scale indicator only.

**Evaluation and bias**

- Röttger, Vidgen, Nguyen, Waseem, Margetts & Pierrehumbert, "HateCheck: Functional Tests for Hate Speech Detection Models," ACL 2021 — 29 functionalities, 3,728 cases, non-hateful contrasts.
- Dixon, Li, Sorensen, Thain & Vasserman, "Measuring and Mitigating Unintended Bias in Text Classification," AIES 2018 — identity-term false positives.
- Sap, Card, Gabriel, Choi & Smith, "The Risk of Racial Bias in Hate Speech Detection," ACL 2019 — AAE tweets up to twice as likely to be labeled offensive.
- Kurrek, Saleem & Ruths, "Towards a Comprehensive Taxonomy and Large-Scale Annotated Corpus for Online Slur Usage," ALW 2020 — 4 categories, 12 subcategories, 39.8k comments.
- Oueslati et al., "Lost in Moderation: How Commercial Content Moderation APIs Over- and Under-Moderate Group-Targeted Hate Speech and Linguistic Variations," CHI 2025 — five APIs, five million queries.

**Lexicons**

- LDNOOBW, _List of Dirty, Naughty, Obscene and Otherwise Bad Words_ (Shutterstock), CC BY 4.0 — ~28 languages; README states the autocomplete-suppression criterion and the subjectivity caveat.

**Landscape (dated)**

- Perspective API sunset notice, `perspectiveapi.com/faq` and the developer FAQ — service ends 31 December 2026, no migration support, quota requests closed February 2026.
- Azure Content Moderator deprecation and migration guidance — retirement March 2027; the replacement has no built-in term list.

### A note on confidence

**Well supported.** The frequency and base-rate data, the Unicode standards, the adversarial-attack papers, the false-positive catalogue, and the Perspective sunset are drawn from primary sources and are directly citable.

**One data point, not a consensus.** The lexical-vs-transformer comparison rests substantially on a single study, in one language, on one text genre. Its direction is corroborated by the n-gram ablation inside that same study, by the structure of the task, and by the self-reported obfuscation weakness of an independent ML detector — but it remains thin, and a contrary result on English conversational text would not be surprising.

**Indicative only.** The latency figures come from mismatched hardware and workloads. They are useful for ruling architectures in or out by order of magnitude and useless as benchmarks.

**Read for shape, not ranking.** Published library comparisons are authored by entrants. Take from them that naive filters score poorly on obfuscation and that even good ones miss a third of it; take nothing about which package is best.

**Perishable.** The appendix is a snapshot. Vendor categories, pricing, quotas, and existence change fast — verify anything in it before acting on it.
