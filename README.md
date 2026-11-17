# dsh-web-login

[中文](README.zh.md) | **English**

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-4B8BBE)](https://github.com/deepseek-ai/deepseek-harness)
[![Node](https://img.shields.io/badge/node-%E2%89%A524.9-339933)](https://nodejs.org)

Username/password sign-in for the DeepSeek Harness (DSH) Web UI. One global account replaces the launch-token URL: every device gets a login page, and a successful sign-in mints the normal DSH session cookie (30 days by default).

## Features

- **Single global account** — one username and one password for every device.
- **No more token copying** — sign in with a password; the launch-token URL remains available as the recovery path.
- **Manage in the UI** — change the username or password under **Settings → Web login**, with the current password required.
- **Secure by default** — scrypt hashing (N=16384, r=8, p=1) with a 16-byte salt; account file is `0600`.
- **Rate limited** — 5 failed attempts per IP per minute, then `429`.
- **Native session handling** — reuses DSH's token exchange and signed cookies; no cookie logic is re-implemented.
- **Bilingual UI** — login page follows `Accept-Language`; settings page follows the DSH locale.

## Install

```sh
dsh plugin --profile web add github:simpleobj/dsh-web-login
```

Then make sure `dsh-web-login` is listed in `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json`:

```jsonc
{
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-web-login"] } }
}
```

Restart `dsh web` and open `http://<host>:<port>/`. When no account exists yet, the login page offers **Create account**; otherwise it asks you to sign in.

Requirements: DSH 0.2.x, Node.js ≥ 24.9.

## Usage

| Task | How |
| --- | --- |
| Sign in | Open `http://<host>:<port>/` and enter the account credentials |
| Change username / password | **Settings → Web login**, current password required |
| Forgot password | Open the launch-token URL printed by `dsh web`, then reset under **Settings → Web login** — or delete `~/.dsh/web-login.json` and set up again |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | DSH data directory; the account file lives here |
| `DSH_WEB_LOGIN_FILE` | `$DSH_HOME/web-login.json` | Override the account file path |

## Security notes

- The account file stores only a salted scrypt hash, never the plaintext password.
- TLS is recommended; behind plain HTTP, restrict the port to trusted networks.
- Changing the password does **not** revoke sessions already signed in on other devices — they stay valid until the cookie expires. To revoke everything, remove the `client-connection/browser-session` record from `$DSH_HOME/.credentials.yaml` and restart dsh.
- One account per instance by design.

## Troubleshooting

- **`403 forbidden` on submit** — the request was rejected by DSH's Host/Origin fence. Make sure the address in your browser matches `dsh web --trusted-host` (e.g. `--trusted-host 1.2.3.4:3080`). Browsers may also send `Origin: null` when a form is resubmitted after refresh; current versions handle that case.
- **`429`** — login rate limit; retry after the `Retry-After` seconds.
- **`405` on `/dsh-login/authenticate`** — expected; that route only accepts POST from the login page.

## License

[MIT](LICENSE)
