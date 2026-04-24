# Sponsorship setup — parked draft

Activation kit for the `❤️ Sponsor` button on the repo. Lives alongside [`FUNDING.yml`](FUNDING.yml) which is also currently parked (every channel commented out). Nothing here is live yet.

## Plan

**Strategy:** personal Buy Me a Coffee account, project-forward copy.

- One BMC account accumulates supporters across every tool Jonathan ever ships — doesn't fragment into per-project accounts
- Project name leads in the About copy so first-time visitors from this repo still see *"am I in the right place?"* confirmation on first glance
- Casual tip-jar vibe (no tiers, no subscriptions, no rewards) matches the tool's voice

## Page fields — to paste into buymeacoffee.com when activating

### Name

```
Jonathan Papworth
```

### About

> Hi, I'm Jonathan. I love data, I love building, and I love the moment when a tool makes someone's afternoon shorter.
>
> My current project is **Power BI Documenter** — a small open-source app that turns any PBIP folder into a searchable dashboard plus nine Markdown docs (ADO Wiki / GitHub-ready). Runs in your browser (nothing uploads) or as a local CLI. MIT, zero dependencies, free forever.
>
> If a coffee feels right, it keeps evenings productive and helps the next idea actually ship. Thanks for being here. ☕

### Website or social link

```
https://github.com/jonathan-pap
```

*GitHub profile rather than the project repo — keeps the link relevant if future projects are added later.*

## Activation steps

1. Create the BMC account at <https://www.buymeacoffee.com/signup>. Note the username (it becomes the URL `buymeacoffee.com/<username>`).
2. Paste the Name / About / Website values above into the BMC profile setup.
3. Edit [`FUNDING.yml`](FUNDING.yml) — uncomment the `buy_me_a_coffee:` line and fill in the username:

   ```yaml
   buy_me_a_coffee: <username-here>
   ```

4. Commit + push. GitHub re-indexes within minutes and the `❤️ Sponsor` button appears on the repo main page + next to "About".

5. (Optional) Delete this file. It's scaffolding; once activated it's duplication.

## If Strategy B isn't the right fit later

Alternative BMC copy variants live in the conversation history that produced this file — includes a project-dedicated variant (Strategy A, "Power BI Documenter" as the Name) and a more understated take. Re-running that conversation or rewriting from scratch is fine; this file is a snapshot of one reasonable starting point, not a constraint.
