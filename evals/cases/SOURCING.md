# Sourcing evaluation cases

The cases are the test set. Written by one person, they would only show what
that person imagines people want. Instead, each case starts from a goal someone
described in a public post: what they want to get better at, by when, and what
their weeks look like. The texts are new; the goals and constraints come from
people.

This protocol was added on 2026-09-24, before any case was written (section 4
of the [pre-registration](../PREREGISTRATION.md)). The format and labeling rules
are in [README.md](README.md).

## Who the cases are about

Cadencia is for people with a goal, a date or a direction, and a week that is
already full. The cases spread over these groups, recorded per case as
`segment`:

| Segment | Situation |
|---|---|
| `busy_worker` | A full-time job, with only early mornings or evenings free |
| `shift_worker` | Rotating or night shifts, so every week is different |
| `parent` | Caregiving, with short and interrupted windows |
| `student` | Exams, semesters and deadlines |
| `career_switcher` | Learning a skill for a new job |
| `returning` | Coming back to something after years away |
| `event` | A dated event: a race, a trip, a move, a recital |
| `hobbyist` | Practice for its own sake, with no date |

## Where posts come from

- Public pages anyone can read without an account, where people describe their
  own goals: forums, Reddit communities and Q&A sites such as Stack Exchange, in
  English and Spanish.
- Found through web search and read with a normal page fetch. No logins, no
  APIs, no bulk collection, and no working around a site that blocks fetching.
  A blocked page is read from its search result or skipped.

## From a post to a case

- **Keep the facts:** the goal, the deadline, the days and times, the weekly
  time, the level, and whatever makes the week hard.
- **Write a new text**, the way that person would type the goal into Cadencia.
  No sentence is copied, and no run of more than five words matches the post.
- **Keep the voice:** short or long, formal or casual, with the kind of detail
  the person gave.
- **Leave out anything that points to the person:** names, usernames,
  employers, schools, cities, exact ages and unusual life events.
- **Pick a `today`** that makes the post's timing work. Relative deadlines are
  read against it.

## Sensitive topics

Health, pain, pregnancy, eating, weight and anything harmful are never one
person's story. A case on these topics is a composite: a pattern seen in at
least two posts, written from scratch, with no community recorded.

## Written for coverage

Some cases no post covers, mainly adversarial texts that try to change the
rules. These are written from scratch and marked `constructed`.

## Provenance

`provenance.jsonl` has one line per case and is committed with the cases:

| Field | Required | Values |
|---|---|---|
| `id` | yes | The case's id |
| `origin` | yes | `post` (one public post), `composite` (a pattern across posts) or `constructed` (written for coverage) |
| `platform` | for `post` | Where the post was, such as `reddit`, `stackexchange` or `forum` |
| `community` | no | The community or section, such as `r/C25K`. Never for `composite` |
| `source_language` | for `post` | `en` or `es` |
| `read` | for `post` | `full` if the whole post was read, `snippet` if only a search result was |
| `segment` | yes | One of the segments above |
| `collected` | yes | The date the source was read (`YYYY-MM-DD`) |
| `review` | yes | The outcome after the audit and the owner's decisions: `accepted`, `relabeled` or `rewritten` |

Links to posts are not committed: they would point to people, and the cases are
written so they don't. The links are kept in `sources.private.jsonl` beside the
cases, which git ignores, so the owner can check any case. The validator
refuses a provenance line that holds a link or a username.

## Verification

After drafting, a separate agent, not the one that drafted the case, opens every
recorded link and confirms that the page exists, is public, and describes the
case's goal and constraints. A case that fails becomes `constructed`. Only
verified cases count as adapted from posts.

A clarifying answer is part of its case. If the answer names a target, a
schedule or a detail the post leaves open, the case counts as written for
coverage, even when the question itself comes from the post.

## Edits before the audit

The agent that combines the drafts may fill a label a draft left out, correct a
note, round or drop a detail that could lead back to a post, and reword text that
repeats a post. It changes no decision. The owner sees every such edit, by case
id.

## Audit and owner check

The pre-registration first had the owner read every case. Before any run, the
owner chose this instead:

- **Audit.** A separate agent reads every case from a customer's side: does it
  read like what a person types into Cadencia, does the set cover how people
  behave (short and messy inputs, questions, impatience, emojis), and would a
  careful planner and a reasonable customer agree with each label. It proposes
  rewrites, drops and label changes, and lists its doubts. Rewrites keep every
  fact and add none.
- **Owner decisions.** Nothing changes until the owner decides each proposal and
  each doubt.
- **Random check.** The owner then checks a random 20 cases, drawn from the
  final set with a recorded seed, and says which labels they disagree with. The
  number they agree with is reported with the results, and a label they change
  is changed in the set.

Each case's review outcome (`accepted`, `relabeled` or `rewritten`) counts every
change the audit or the owner made, and `review.json` records the drafts
dropped. After the owner's check, no agent changes a case.

## Isolation

The drafting and verification agents run a Claude model, which is neither arm.
They read this file, the pre-registration and [README.md](README.md), and
nothing from `service/`, `lib/samples/` or earlier runs. They never call
DeepSeek or OpenAI.

## Ids and order

Final ids (`c001` onward) come from a shuffle with a recorded seed, so if the
budget stops a run early, the cases it covered still mix languages, decisions
and domains. `review.json` beside the cases records the seed, how many drafts
were written and dropped, and the random check, and the report prints them.

## What can be claimed

"N goals adapted from public posts (paraphrased and de-identified) and M written
for coverage; every label audited by a separate agent, and the owner agreed with
K of 20 checked at random." Not "real users" and not "real cases": nobody typed
these into Cadencia.
