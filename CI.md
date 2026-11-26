# CI

- `test` runs both plugin test suites on Windows, Linux, and macOS with Node 20, 22, and 24.
- `portability` runs dry-run, clean temporary HOME install, expected-file checks, and uninstall using a fixture Herdr executable on the same matrix.
- `hygiene` checks plugin names and user paths, LF endings, parseable TOML manifests, and Quick Start/Upgrading in each plugin README.

Run locally with `node test/run-all.mjs`; the runner installs the pinned `smol-toml@1.5.2` hygiene dependency in a temporary directory. A green matrix is required before tagging `verX.Y`. CI does not publish releases.
