# Bioarc policy

1. A developer selects one app or package before editing.
2. The selected target is writable by default.
3. Internal dependencies and consumers are readable context, not writable scope.
4. Root manifests and lockfiles remain writable for dependency work.
5. Other apps and packages require explicit `/bioarc expand <target>`.
6. Existing dirty files are recorded as a baseline and are not owned by Bioarc.
7. Validation uses existing package scripts and filtered Turborepo commands.
8. Bioarc blocks deterministic write/edit violations and obvious mutating bash commands.
9. Bioarc is not an OS sandbox; CI, branch protection, and permissions remain authoritative.
