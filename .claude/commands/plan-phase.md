---
description: Draft the task breakdown for the next roadmap phase for human approval
---

Use the `project-manager` agent to draft tasks for phase $ARGUMENTS (or the next phase if none is given):

1. List every P0 requirement in `docs/PRD.md` that belongs to that phase according to `docs/ROADMAP.md`.
2. Break them into tasks small enough for one PR each: ID, description, requirement IDs, owner agent, dependencies, acceptance criteria.
3. Add them to `docs/ROADMAP.md` under a new "Phase N tasks" table with status `proposed`.
4. Summarise the plan for me in under 10 lines and ask for approval before changing any status to `todo`.
