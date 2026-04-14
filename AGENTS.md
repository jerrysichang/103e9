# Agent Workflow Commands

When the user says exactly `make logged changes`, run this workflow:

1. Export open issues from the synced vault:
   - Command: `npm run issues:export-open`
   - Requirement: `SYNC_PASSPHRASE` environment variable must already be set in the terminal session.
2. Read `.cursor/open-issues.json`.
3. Implement open issues sequentially in listed order.
4. After each issue:
   - make the code change,
   - run relevant checks/tests,
   - report what changed.
5. If blocked on any issue:
   - stop immediately,
   - report blocker and remaining issue IDs.
6. Do not mark issues complete automatically in app data. Completion remains manual in the app.

If `.cursor/open-issues.json` has zero open issues, report that there is nothing to implement and stop.
