# Getting Prism's agents running

## 1. Create the repository (you)

1. On GitHub, create an empty repository (for example `prism`). Public if you want contributors from day one.
2. Unzip this starter, then from inside the folder:

   ```bash
   git init -b main
   git add .
   git commit -m "Prism starter: PRD, roadmap, agent setup"
   git remote add origin https://github.com/<you>/prism.git
   git push -u origin main
   ```

3. Claim the npm organisation `prismtest` and register prism.dev (or a fallback) when you are ready.

## 2. Use the builder agents

Open the repo in Claude Code (terminal, desktop, or claude.ai/code). Claude reads `CLAUDE.md` automatically and the agents in `.claude/agents/` become available.

- `/next-task` — picks the next ready roadmap task, hands it to the right specialist agent, then gets it reviewed.
- `/next-task P0-06` — work on a specific task.
- `/plan-phase 1` — drafts the next phase's tasks for your approval.
- `/weekly-report` — syncs the roadmap and writes a status report.

You can also ask directly, for example "use the android-engineer agent on P0-09".

Start with **P0-01** (monorepo tooling) and **P0-02** (protocol design): everything else depends on them.

## 3. Turn on the manager agent (scheduled)

Once the repo is on GitHub, tell Claude in the chat where you built this starter: "the repo is `<you>/prism`, set up the weekly manager". It will create a scheduled task that runs the `project-manager` agent every week and reports back to you.

## 4. What stays with you

Merging PRs, publishing to npm, secrets and accounts, iOS signing, physical devices and spending money. Agents list these under "Needs a human" in PRs and in `docs/ROADMAP.md`.
