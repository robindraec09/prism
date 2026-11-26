---
description: Pick the next ready task from the roadmap and hand it to the right agent
---

1. Read `docs/ROADMAP.md`. Find `todo` tasks whose dependencies are all `done`. $ARGUMENTS may name a task ID or an agent; respect it if given.
2. Pick the highest-priority ready task (lowest phase, then lowest ID). Skip tasks that need a human and are not unblocked.
3. Tell me which task you picked, its owner agent and its acceptance criteria in two or three lines.
4. Delegate the implementation to the owner agent listed in the task. When it finishes, have the `reviewer` agent review the change and report the verdict.
5. Update the task status in `docs/ROADMAP.md` (`review` once a PR is open).
