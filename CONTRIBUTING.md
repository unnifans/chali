# Contributing to Chali

Thanks for your interest in contributing! We welcome bug reports, feature requests, and pull requests that improve Chali.

## Filing issues
- Use the repository Issues tab to report bugs or suggest features. Provide a clear title and reproduction steps or a short description of the proposed feature.
- Include environment details when relevant (browser + version, Node/npm version, Firebase project configuration if applicable).

## Proposing changes (Pull Requests)
1. Fork the repository and create a branch from main: `git checkout -b fix/short-description`.
2. Make small, focused commits with clear commit messages.
3. Push your branch and open a PR against `main` in this repository.
4. In the PR description, include:
   - What you changed and why
   - How to reproduce or test the change
   - Any migration or env changes required

### PR checklist
- [ ] The change is documented (README, CONTRIBUTING, or inline comments where appropriate)
- [ ] The change doesn't break local dev (run `npm run dev` in `frontend` to smoke-test UI changes)
- [ ] Any secrets or service account keys are not committed
- [ ] If the change touches Cloud Functions, include a short test plan for deploying and verifying the function

## Coding style
- Follow the existing project conventions. The frontend uses plain JavaScript, HTML, and CSS; keep changes consistent with the surrounding code.
- If you add dependencies, keep them minimal and document why they're needed.

## Tests & verification
- There are no automated tests included at the moment. When possible, include a short manual test plan in your PR.
- If you add tests, include instructions to run them in the PR description.

## Commit messages
- Use short, descriptive commit messages. Prefix with a type where appropriate (e.g., `fix:`, `feat:`, `docs:`, `chore:`).

## Security
- Do not commit secrets, API keys, or service account files. Use environment variables and document required variables in the README.
- If you discover a security issue, open a private issue or contact the maintainer directly (see Contact in the README).

## Review process
- PRs will be reviewed by the project maintainer(s). Expect feedback and iterate on changes as requested.
- The maintainer may merge and squash commits when appropriate.

## Local development notes
- Frontend dev server: `cd frontend && npm install && npm run dev`
- Seed script: `cd scripts && npm install && node seed.js` (requires `scripts/service-account.json` — do not commit this file)
- Deploy Cloud Functions: `cd functions && npm install && npm run deploy`

## Code of conduct
Be respectful and considerate. This is a small project and all contributors should strive for constructive, friendly communication.

---
If you have questions about contributing, open an issue or mention @unnifans in the discussion.
