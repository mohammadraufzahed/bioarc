# Bioarc default metadata

These YAML files are shipped inside the plugin and provide a baseline for every workspace target discovered in the Bioarc modules monorepo.

They are intentionally conservative:

- the target itself is writable;
- dependencies and consumers are readable context;
- cross-target writes require explicit scope expansion;
- validation uses existing workspace scripts;
- `summary` is factual when the package manifest has no description.

A consuming repository can override a target by adding `bioarc.yaml` beside its `package.json`. The plugin does not write to `apps/` or `packages/` to install or use these defaults.
