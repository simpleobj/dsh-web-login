/**
 * dsh-web-login — Host half.
 *
 * The shipped DSH Web GUI authenticates a browser by exchanging a per-process
 * launch token (`?token=...`) for a signed session cookie. This plugin adds a
 * single global username/password account in front of that exchange:
 *
 * - `ctx.connection.authorizeIndex` is wrapped so an unauthenticated browser
 *   receives a login page instead of the terse 401 text. A successful sign-in
 *   redirects to the still-supported launch-token URL, which mints the normal
 *   Connection cookie — no cookie format is reimplemented here.
 * - `/dsh-login/authenticate` and `/dsh-login/setup` handle the login forms.
 * - `/dsh-login/account` serves the Settings page (requires the normal
 *   Connection browser cookie).
 *
 * The account lives in `$DSH_HOME/web-login.json` (0600) as a scrypt hash.
 * @module dsh-web-login
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

/** Stable Cordis plugin name. */
export const name = 'dsh-web-login'

/** Services this plugin cannot work without. */
export const inject = ['webServer', 'connection']

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SCRYPT_MAXMEM = 64 * 1024 * 1024

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 512
const MAX_USERNAME_LENGTH = 64
const MAX_BODY_BYTES = 16 * 1024

const LOGIN_WINDOW_MS = 60_000
const LOGIN_MAX_FAILURES = 5

const ROUTE_AUTHENTICATE = '/dsh-login/authenticate'
const ROUTE_SETUP = '/dsh-login/setup'
const ROUTE_ACCOUNT = '/dsh-login/account'

/** Resolve the account file once per activation; env overrides help tests. */
function resolveAccountFile() {
  const explicit = process.env.DSH_WEB_LOGIN_FILE
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit.trim())
  const configuredHome = process.env.DSH_HOME
  const home = typeof configuredHome === 'string' && configuredHome.trim() !== ''
    ? configuredHome.trim()
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'web-login.json')
}

/** Read one header from either a Fetch `Headers` or a Node header record. */
function readHeader(headers, name) {
  if (headers === undefined || headers === null) return undefined
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isHex(value, bytes) {
  return typeof value === 'string' && value.length === bytes * 2 && /^[0-9a-f]+$/i.test(value)
}

function codePointLength(value) {
  return [...value].length
}

function validateUsername(value) {
  if (typeof value !== 'string') return false
  if (value.length < 1 || value.length > MAX_USERNAME_LENGTH) return false
  return !/[\u0000-\u001f\u007f]/.test(value)
}

function validatePassword(value) {
  if (typeof value !== 'string') return false
  const length = codePointLength(value)
  return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH
}

async function derive(password, salt, params = {}) {
  return scrypt(password, salt, KEY_LENGTH, {
    N: params.N ?? SCRYPT_N,
    r: params.r ?? SCRYPT_R,
    p: params.p ?? SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
}

async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await derive(password, salt)
  return {
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }
}

async function verifyPassword(account, password) {
  const expected = Buffer.from(account.hash, 'hex')
  const actual = Buffer.from(await derive(password, Buffer.from(account.salt, 'hex'), account))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function normalizeAccount(value, file) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`web login account file ${file} does not contain an account object`)
  }
  const { username, salt, hash } = value
  if (typeof username !== 'string' || !validateUsername(username)) {
    throw new Error(`web login account file ${file} has an invalid username`)
  }
  if (!isHex(salt, 16) || !isHex(hash, KEY_LENGTH)) {
    throw new Error(`web login account file ${file} has an invalid password hash`)
  }
  const params = {
    N: Number.isInteger(value.N) && value.N > 1 ? value.N : SCRYPT_N,
    r: Number.isInteger(value.r) && value.r > 0 ? value.r : SCRYPT_R,
    p: Number.isInteger(value.p) && value.p > 0 ? value.p : SCRYPT_P,
  }
  return {
    version: 1,
    username,
    salt,
    hash,
    ...params,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
  }
}

async function readAccount(file) {
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`web login account file ${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`web login account file ${file} is not valid JSON`)
  }
  return normalizeAccount(parsed, file)
}

/**
 * Synchronous read for the index gate: frontend-static's recorder response
 * must be written before `authorizeIndex` returns, so the gate cannot await.
 */
function readAccountSync(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`web login account file ${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`web login account file ${file} is not valid JSON`)
  }
  return normalizeAccount(parsed, file)
}

async function writeAccount(file, account) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const payload = JSON.stringify(account, null, 2) + '\n'
  try {
    await fs.writeFile(temporary, payload, { mode: 0o600 })
    await fs.rename(temporary, file)
    await fs.chmod(file, 0o600).catch(() => {})
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/** Send a Fetch response through a Node response; used to re-serve the app index. */
async function pipeFetchResponse(res, response, method) {
  const headers = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  res.writeHead(response.status, headers)
  if (method === 'HEAD' || response.body === null) {
    res.end()
    return
  }
  const stream = Readable.fromWeb(response.body)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

function loginPageCopy(lang) {
  if (lang === 'zh') {
    return {
      title: '账号登录',
      createTitle: '创建账号',
      signInLead: '登录这台 DSH Web 实例。',
      setupLead: '这是首次登录。请创建这台 DSH Web 实例唯一的账号。',
      username: '账号',
      password: '密码',
      confirm: '确认密码',
      signIn: '登录',
      create: '创建账号并登录',
      errorInvalid: '账号或密码不正确。',
      errorMissing: '请输入账号和密码。',
      errorUsername: '请输入账号（1–64 个字符）。',
      errorWeak: '密码至少需要 8 个字符。',
      errorMismatch: '两次输入的密码不一致。',
      footer: '启动 dsh web 时打印的 token 链接仍然有效，可用于找回密码：先用它登录，再到「设置 → Web 登录」修改。',
      setupWarning: '设置完成后，进入这台实例的任何设备都需要用该账号登录。',
      brand: 'DeepSeek Harness',
    }
  }
  return {
    title: 'Password sign-in',
    createTitle: 'Create the account',
    signInLead: 'Sign in to this DSH Web instance.',
    setupLead: 'This is the first sign-in. Create the single account used by this DSH Web instance.',
    username: 'Username',
    password: 'Password',
    confirm: 'Confirm password',
    signIn: 'Sign in',
    create: 'Create account and sign in',
    errorInvalid: 'Incorrect username or password.',
    errorMissing: 'Enter a username and password.',
    errorUsername: 'Enter a username of 1–64 characters.',
    errorWeak: 'Use a password of at least 8 characters.',
    errorMismatch: 'The passwords do not match.',
    footer: 'The launch-token URL printed by dsh web still works as a recovery sign-in: use it, then change the password in Settings → Web login.',
    setupWarning: 'After setup, every device that opens this instance signs in with this account.',
    brand: 'DeepSeek Harness',
  }
}

function renderLoginPage({ lang, configured, username = '', error = null, serverError = null }) {
  const copy = loginPageCopy(lang)
  const title = configured ? copy.title : copy.createTitle
  const lead = configured ? copy.signInLead : copy.setupLead
  const action = configured ? './dsh-login/authenticate' : './dsh-login/setup'
  const submit = configured ? copy.signIn : copy.create

  let errorText = null
  if (serverError !== null) errorText = serverError
  else if (error === 'invalid') errorText = copy.errorInvalid
  else if (error === 'missing') errorText = copy.errorMissing
  else if (error === 'username') errorText = copy.errorUsername
  else if (error === 'weak') errorText = copy.errorWeak
  else if (error === 'mismatch') errorText = copy.errorMismatch

  const usernameField = `
      <label class="field">
        <span class="label">${escapeHtml(copy.username)}</span>
        <input class="input" type="text" name="username" value="${escapeHtml(username)}"
          autocomplete="username" maxlength="${MAX_USERNAME_LENGTH}" required autofocus
          spellcheck="false" autocapitalize="off">
      </label>`

  const passwordField = `
      <label class="field">
        <span class="label">${escapeHtml(copy.password)}</span>
        <input class="input" type="password" name="password"
          autocomplete="${configured ? 'current-password' : 'new-password'}" required>
      </label>`

  const confirmField = configured
    ? ''
    : `
      <label class="field">
        <span class="label">${escapeHtml(copy.confirm)}</span>
        <input class="input" type="password" name="confirm" autocomplete="new-password" required>
      </label>`

  const warning = configured ? '' : `<p class="warning">${escapeHtml(copy.setupWarning)}</p>`

  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-Hans' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(copy.brand)} · ${escapeHtml(title)}</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: #eef4ff;
  background:
    radial-gradient(1100px 700px at 18% -10%, #1d5aa8 0%, rgba(29, 90, 168, 0) 60%),
    radial-gradient(900px 600px at 100% 110%, #0f3c74 0%, rgba(15, 60, 116, 0) 55%),
    #071323;
}
.card {
  width: 100%;
  max-width: 404px;
  padding: 30px 30px 24px;
  border-radius: 22px;
  background: rgba(13, 27, 48, .82);
  border: 1px solid rgba(255, 255, 255, .12);
  box-shadow: 0 28px 70px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .06);
  backdrop-filter: blur(14px);
}
.brand { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
.brand svg { width: 40px; height: 40px; flex: none; }
.brand-name { font-size: 15px; font-weight: 600; letter-spacing: .2px; color: #cfe2fb; }
h1 { margin: 0 0 8px; font-size: 24px; line-height: 32px; font-weight: 600; letter-spacing: -.2px; }
.lead { margin: 0 0 20px; color: #9fb4d4; font-size: 14px; line-height: 22px; }
.warning {
  margin: 0 0 18px; padding: 10px 12px; border-radius: 10px;
  background: rgba(255, 196, 90, .1); border: 1px solid rgba(255, 196, 90, .28);
  color: #f0c983; font-size: 12px; line-height: 18px;
}
.alert {
  margin: 0 0 18px; padding: 10px 12px; border-radius: 10px;
  background: rgba(255, 96, 96, .12); border: 1px solid rgba(255, 96, 96, .32);
  color: #ffb4b4; font-size: 13px; line-height: 20px;
}
form { display: flex; flex-direction: column; gap: 14px; margin: 0; }
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 13px; line-height: 20px; color: #c6d6ee; }
.input {
  width: 100%; height: 42px; padding: 0 13px;
  border-radius: 11px; border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(4, 12, 24, .55);
  color: #f2f7ff; font: inherit; font-size: 14px; outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.input::placeholder { color: #6d819f; }
.input:focus { border-color: #5da2f0; box-shadow: 0 0 0 3px rgba(93, 162, 240, .22); }
.button {
  margin-top: 6px; height: 42px; border: 0; border-radius: 11px;
  background: linear-gradient(180deg, #3b8ae6, #2b6fc9);
  color: #fff; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: filter .15s, transform .05s;
}
.button:hover { filter: brightness(1.08); }
.button:active { transform: translateY(1px); }
.button:focus-visible { outline: 2px solid #8dc2ff; outline-offset: 2px; }
.footer { margin: 22px 0 0; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, .08); color: #7f93b2; font-size: 11.5px; line-height: 18px; }
.footer code { color: #a9c1e2; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
</head>
<body>
<main class="card">
  <div class="brand">
    <svg viewBox="0 0 64 64" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#2f7fd6"/>
      <path d="M20 29v-4.5a12 12 0 0 1 24 0V29" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
      <rect x="15" y="28" width="34" height="24" rx="7" fill="#fff"/>
      <circle cx="32" cy="38" r="4" fill="#14509e"/>
      <path d="M32 40.5v6" stroke="#14509e" stroke-width="4" stroke-linecap="round"/>
    </svg>
    <span class="brand-name">${escapeHtml(copy.brand)}</span>
  </div>
  <h1>${escapeHtml(title)}</h1>
  <p class="lead">${escapeHtml(lead)}</p>
  ${errorText !== null ? `<p class="alert" role="alert">${escapeHtml(errorText)}</p>` : ''}
  ${warning}
  <form method="post" action="${action}">
    ${usernameField}
    ${passwordField}
    ${confirmField}
    <button class="button" type="submit">${escapeHtml(submit)}</button>
  </form>
  <p class="footer">${escapeHtml(copy.footer)}</p>
</main>
</body>
</html>`
}

function renderFatalPage(message) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH Web login</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#071323;color:#eef4ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:520px;line-height:1.6}code{font-family:ui-monospace,Menlo,monospace;color:#9cc4ff}</style>
</head>
<body><main><h1>Web login is unavailable</h1><p>${escapeHtml(message)}</p><p>Delete or fix the account file, then reload this page.</p></main></body>
</html>`
}

export function apply(ctx) {
  const { webServer, connection } = ctx
  const accountFile = resolveAccountFile()

  const log = (error) => {
    try {
      ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
    } catch {
      /* logging must never break a request */
    }
  }

  const readAccountState = async () => readAccount(accountFile)

  /**
   * The Host/Origin fence only: a trusted-but-unauthenticated request is fine.
   *
   * Chrome sends `Origin: null` when a form POST is resubmitted (F5 on the
   * result page), after some redirect chains, or when a privacy extension
   * strips the header. The stock fence rejects every `Origin: null`, which
   * would lock those users out of the login form. For that single case we
   * re-run the fence without the Origin header: an untrusted Host or a
   * `Sec-Fetch-Site: cross-site` marker is still rejected, while a same-site
   * submission with a scrubbed Origin is admitted.
   */
  const untrusted = (request) => {
    if (connection.requestRejection(request) !== 403) return false
    if (readHeader(request?.headers, 'origin') !== 'null') return true
    const headers = request.headers
    if (headers !== null && headers !== undefined && typeof headers.get === 'function') {
      const copy = new Headers(headers)
      copy.delete('origin')
      return connection.requestRejection({ ...request, headers: copy }) === 403
    }
    const copy = { ...headers }
    delete copy.origin
    return connection.requestRejection({ ...request, headers: copy }) === 403
  }

  /** Only the shared browser Peer may use the Settings API or open the app. */
  const admitted = (request) => {
    const admission = connection.admit(request)
    return 'peer' in admission && admission.peer === connection.browserPeer
  }

  /** Relative so a prefix-stripping proxy keeps the mount. */
  const tokenRedirect = () => {
    try {
      const url = new URL(connection.authenticatedUrl('http://dsh.invalid/'))
      const token = url.searchParams.get('token')
      return `../?token=${encodeURIComponent(token ?? '')}`
    } catch (error) {
      log(error)
      return '../'
    }
  }

  const respondHtml = (request, response, status, html) => {
    response.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-language': requestLanguage(request),
    })
    response.end(request.method === 'HEAD' ? undefined : html)
  }

  const respondJson = (response, status, value) => {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    })
    response.end(JSON.stringify(value))
  }

  const respondText = (response, status, text) => {
    response.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(`${text}\n`)
  }

  const redirect = (response, location) => {
    response.writeHead(303, {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    response.end()
  }

  const requestLanguage = (request) => {
    const header = readHeader(request?.headers, 'accept-language') ?? ''
    return header.trim().toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }

  const methodNotAllowed = (response, allow) => {
    response.writeHead(405, { allow, 'cache-control': 'no-store' })
    response.end()
  }

  /** Read a bounded request body; rejects with a mapped status. */
  async function readBody(request) {
    const chunks = []
    let total = 0
    for await (const chunk of request) {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        const error = new Error('request body is too large')
        error.statusCode = 413
        throw error
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  function parseForm(text) {
    const params = new URLSearchParams(text)
    const result = {}
    for (const [key, value] of params) result[key] = value
    return result
  }

  // ---- login-rate limiting -------------------------------------------------

  const failures = new Map()

  const rateKey = (request) => {
    try {
      return request.socket?.remoteAddress ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  const rateLimitedFor = (key) => {
    const entry = failures.get(key)
    if (entry === undefined) return 0
    const remaining = entry.resetAt - Date.now()
    if (remaining <= 0) {
      failures.delete(key)
      return 0
    }
    return entry.count >= LOGIN_MAX_FAILURES ? Math.ceil(remaining / 1000) : 0
  }

  const recordFailure = (key) => {
    const now = Date.now()
    const entry = failures.get(key)
    if (entry === undefined || entry.resetAt <= now) {
      failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
      return
    }
    entry.count += 1
  }

  // ---- index authorization gate -------------------------------------------

  /**
   * Serve the login page to a browser that has neither a valid cookie nor a
   * launch token. The response object may be a real Node response (the
   * inspector) or the small recorder frontend-static passes, so only
   * `writeHead`/`end` are used and the account state is read synchronously.
   */
  const serveLoginOrIndex = (request, response) => {
    if (typeof request?.url !== 'string') return undefined
    let url
    try {
      url = new URL(request.url, 'http://dsh.invalid')
    } catch {
      return undefined
    }
    if (url.searchParams.has('token')) return undefined
    if (url.pathname !== '/' && url.pathname !== '/index.html') return undefined
    if (admitted(request)) return undefined

    try {
      const account = readAccountSync(accountFile)
      respondHtml(request, response, 200, renderLoginPage({
        lang: requestLanguage(request),
        configured: account !== null,
      }))
    } catch (error) {
      log(error)
      respondHtml(request, response, 500, renderFatalPage(error instanceof Error ? error.message : String(error)))
    }
    return false
  }

  const originalAuthorizeIndex = connection.authorizeIndex
  const wrappedAuthorizeIndex = function wrappedAuthorizeIndex(request, response, ...rest) {
    try {
      if (serveLoginOrIndex(request, response) === false) return false
    } catch (error) {
      log(error)
    }
    return originalAuthorizeIndex.call(this, request, response, ...rest)
  }

  ctx.effect(() => {
    connection.authorizeIndex = wrappedAuthorizeIndex
    return () => {
      if (connection.authorizeIndex === wrappedAuthorizeIndex) delete connection.authorizeIndex
    }
  }, 'web-login: gate the index page')

  // ---- login form ----------------------------------------------------------

  const handleAuthenticate = async (request, response) => {
    if (request.method !== 'POST') return methodNotAllowed(response, 'POST')
    if (untrusted(request)) return respondText(response, 403, 'forbidden')
    const key = rateKey(request)
    const retryAfter = rateLimitedFor(key)
    if (retryAfter > 0) {
      response.writeHead(429, { 'retry-after': String(retryAfter), 'cache-control': 'no-store' })
      response.end('too many attempts\n')
      return
    }

    let account
    try {
      account = await readAccountState()
    } catch (error) {
      log(error)
      return respondHtml(request, response, 500, renderFatalPage(error.message))
    }
    if (account === null) return redirect(response, '../')

    let form
    try {
      form = parseForm(await readBody(request))
    } catch (error) {
      const status = error.statusCode === 413 ? 413 : 400
      return respondText(response, status, 'bad request')
    }

    const username = typeof form.username === 'string' ? form.username.trim() : ''
    const password = typeof form.password === 'string' ? form.password : ''
    if (!username || !password) {
      return respondHtml(request, response, 400, renderLoginPage({
        lang: requestLanguage(request), configured: true, username, error: 'missing',
      }))
    }

    let valid = false
    try {
      // Always derive, even for a wrong username, so the two failures are not
      // distinguishable by timing.
      const passwordValid = await verifyPassword(account, password)
      valid = username === account.username && passwordValid
    } catch (error) {
      log(error)
      return respondHtml(request, response, 500, renderFatalPage('The stored password hash could not be checked.'))
    }
    if (!valid) {
      recordFailure(key)
      return respondHtml(request, response, 401, renderLoginPage({
        lang: requestLanguage(request), configured: true, username, error: 'invalid',
      }))
    }
    failures.delete(key)
    redirect(response, tokenRedirect())
  }

  const handleSetup = async (request, response) => {
    if (request.method !== 'POST') return methodNotAllowed(response, 'POST')
    if (untrusted(request)) return respondText(response, 403, 'forbidden')

    let account
    try {
      account = await readAccountState()
    } catch (error) {
      log(error)
      return respondHtml(request, response, 500, renderFatalPage(error.message))
    }
    if (account !== null) return redirect(response, '../')

    let form
    try {
      form = parseForm(await readBody(request))
    } catch (error) {
      const status = error.statusCode === 413 ? 413 : 400
      return respondText(response, status, 'bad request')
    }

    const username = typeof form.username === 'string' ? form.username.trim() : ''
    const password = typeof form.password === 'string' ? form.password : ''
    const confirm = typeof form.confirm === 'string' ? form.confirm : ''

    if (!validateUsername(username)) {
      return respondHtml(request, response, 400, renderLoginPage({
        lang: requestLanguage(request), configured: false, username, error: username ? 'username' : 'missing',
      }))
    }
    if (!validatePassword(password)) {
      return respondHtml(request, response, 400, renderLoginPage({
        lang: requestLanguage(request), configured: false, username, error: 'weak',
      }))
    }
    if (password !== confirm) {
      return respondHtml(request, response, 400, renderLoginPage({
        lang: requestLanguage(request), configured: false, username, error: 'mismatch',
      }))
    }

    const now = new Date().toISOString()
    const record = {
      version: 1,
      username,
      ...(await hashPassword(password)),
      createdAt: now,
      updatedAt: now,
    }
    try {
      await writeAccount(accountFile, record)
    } catch (error) {
      log(error)
      return respondHtml(request, response, 500, renderFatalPage(`The account file ${accountFile} could not be written.`))
    }
    redirect(response, tokenRedirect())
  }

  // ---- settings API --------------------------------------------------------

  const accountError = (response, error) => respondJson(response, 400, { ok: false, error })

  const handleAccount = async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed(response, 'GET, POST')
    if (untrusted(request)) return respondText(response, 403, 'forbidden')
    if (!admitted(request)) return respondJson(response, 401, { ok: false, error: 'unauthorized' })

    let account
    try {
      account = await readAccountState()
    } catch (error) {
      log(error)
      return respondJson(response, 500, { ok: false, error: 'account-unreadable' })
    }

    if (request.method === 'GET') {
      return respondJson(response, 200, {
        ok: true,
        configured: account !== null,
        username: account?.username ?? null,
      })
    }

    const contentType = (readHeader(request.headers, 'content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
    if (contentType !== 'application/json') {
      return respondJson(response, 415, { ok: false, error: 'unsupported-media-type' })
    }

    let input
    try {
      const text = await readBody(request)
      input = text === '' ? {} : JSON.parse(text)
    } catch {
      return accountError(response, 'bad-request')
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return accountError(response, 'bad-request')

    const rawUsername = input.username
    const rawCurrent = input.currentPassword
    const rawNew = input.newPassword
    const username = typeof rawUsername === 'string' ? rawUsername.trim() : undefined
    const currentPassword = typeof rawCurrent === 'string' ? rawCurrent : undefined
    const newPassword = typeof rawNew === 'string' && rawNew !== '' ? rawNew : undefined

    if (account === null) {
      if (!validateUsername(username ?? '')) return accountError(response, username === undefined ? 'missing-username' : 'invalid-username')
      if (!validatePassword(newPassword ?? '')) return accountError(response, 'weak-password')
      const now = new Date().toISOString()
      const record = {
        version: 1,
        username,
        ...(await hashPassword(newPassword)),
        createdAt: now,
        updatedAt: now,
      }
      try {
        await writeAccount(accountFile, record)
      } catch (error) {
        log(error)
        return respondJson(response, 500, { ok: false, error: 'write-failed' })
      }
      return respondJson(response, 200, { ok: true, configured: true, username })
    }

    if (currentPassword === undefined || currentPassword === '') return accountError(response, 'missing-current-password')
    let currentValid = false
    try {
      currentValid = await verifyPassword(account, currentPassword)
    } catch (error) {
      log(error)
      return respondJson(response, 500, { ok: false, error: 'verify-failed' })
    }
    if (!currentValid) return accountError(response, 'wrong-password')

    const next = { ...account, updatedAt: new Date().toISOString() }
    if (username !== undefined && username !== account.username) {
      if (!validateUsername(username)) return accountError(response, 'invalid-username')
      next.username = username
    }
    if (newPassword !== undefined) {
      if (!validatePassword(newPassword)) return accountError(response, 'weak-password')
      Object.assign(next, await hashPassword(newPassword))
    }
    try {
      await writeAccount(accountFile, next)
    } catch (error) {
      log(error)
      return respondJson(response, 500, { ok: false, error: 'write-failed' })
    }
    return respondJson(response, 200, { ok: true, configured: true, username: next.username })
  }

  // ---- routes --------------------------------------------------------------

  const register = (path, handler, label) => {
    ctx.effect(() => webServer.register({ kind: 'exact', path, handler }), label)
  }

  register(ROUTE_AUTHENTICATE, (request, response) => {
    handleAuthenticate(request, response).catch((error) => {
      log(error)
      if (!response.headersSent) respondText(response, 500, 'internal error')
      else response.destroy()
    })
  }, 'web-login: authenticate route')

  register(ROUTE_SETUP, (request, response) => {
    handleSetup(request, response).catch((error) => {
      log(error)
      if (!response.headersSent) respondText(response, 500, 'internal error')
      else response.destroy()
    })
  }, 'web-login: setup route')

  register(ROUTE_ACCOUNT, (request, response) => {
    handleAccount(request, response).catch((error) => {
      log(error)
      if (!response.headersSent) respondJson(response, 500, { ok: false, error: 'internal-error' })
      else response.destroy()
    })
  }, 'web-login: account route')

  ctx.logger?.info?.(`web login account file: ${accountFile}`)
}
