/**
 * dsh-web-login — Client half.
 *
 * Contributes the "Web login" page to Settings → Web login. The page talks to
 * the Host half's `/dsh-login/account` endpoint with the normal Connection
 * browser cookie, so it only works inside an authenticated DSH Web page.
 */
window.__ModuleLoader__.load({
  id: 'dsh-web-login',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'webLogin'

    const EN = {
      nav: 'Web login',
      title: 'Password sign-in',
      description:
        'Sign in to this DSH Web instance with a username and password instead of copying the launch-token URL. The account is global: one username and one password for every device.',
      setupHint: 'No account is set up yet. Create the single account used by this instance.',
      changeHint: 'Change the username or set a new password. Your current password is required.',
      username: 'Username',
      currentPassword: 'Current password',
      newPassword: 'New password',
      newPasswordOptional: 'New password (leave blank to keep the current one)',
      confirmPassword: 'Confirm new password',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved.',
      loading: 'Loading…',
      loadFailed: 'Could not read the account state. Reload the page and try again.',
      sessionExpired: 'Your session has expired. Open the sign-in page and log in again.',
      address: 'Sign-in address',
      addressHint: 'Open this address on another device to sign in with this account.',
      tokenHint: 'Forgot the password? The launch-token URL printed by dsh web still works: use it, then change the password here.',
      errorMissingUsername: 'Enter a username.',
      errorUsername: 'Use a username of 1–64 characters.',
      errorMissingCurrent: 'Enter your current password.',
      errorMissingNew: 'Enter a new password.',
      errorWeak: 'Use a password of at least 8 characters.',
      errorMismatch: 'The new passwords do not match.',
      errorWrongPassword: 'The current password is incorrect.',
      errorNetwork: 'The change could not be saved. Check the connection and try again.',
      errorServer: 'The Host could not save the account. Check the Host logs and try again.',
    }

    const ZH = {
      nav: 'Web 登录',
      title: '账号密码登录',
      description:
        '用账号和密码登录这台 DSH Web 实例，不再需要复制启动 token 链接。账号是全局唯一的：所有设备共用同一个账号和密码。',
      setupHint: '还没有设置账号。请创建这台实例唯一的账号。',
      changeHint: '可以修改账号，或设置新密码。修改时需要输入当前密码。',
      username: '账号',
      currentPassword: '当前密码',
      newPassword: '新密码',
      newPasswordOptional: '新密码（留空则保持不变）',
      confirmPassword: '确认新密码',
      save: '保存',
      saving: '保存中…',
      saved: '已保存。',
      loading: '加载中…',
      loadFailed: '无法读取账号状态。请刷新页面后重试。',
      sessionExpired: '登录状态已过期。请打开登录页重新登录。',
      address: '登录地址',
      addressHint: '在其他设备上打开这个地址，即可用上面的账号登录。',
      tokenHint: '忘记密码？dsh web 启动时打印的 token 链接仍然有效：先用它登录，再回到这里修改密码。',
      errorMissingUsername: '请输入账号。',
      errorUsername: '账号长度需为 1–64 个字符。',
      errorMissingCurrent: '请输入当前密码。',
      errorMissingNew: '请输入新密码。',
      errorWeak: '密码至少需要 8 个字符。',
      errorMismatch: '两次输入的新密码不一致。',
      errorWrongPassword: '当前密码不正确。',
      errorNetwork: '保存失败，请检查网络后重试。',
      errorServer: 'Host 无法保存账号。请查看 Host 日志后重试。',
    }

    const CSS = `
.dshwl-section { display: flex; flex-direction: column; gap: 16px; padding: 8px 0; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
.dshwl-card { display: flex; flex-direction: column; gap: 14px; padding: 16px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); }
.dshwl-head { display: flex; flex-direction: column; gap: 4px; }
.dshwl-title { margin: 0; font-size: 15px; font-weight: 500; line-height: 24px; }
.dshwl-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dshwl-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dshwl-form { display: flex; flex-direction: column; gap: 12px; }
.dshwl-field { display: flex; flex-direction: column; gap: 6px; }
.dshwl-label { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.dshwl-input { box-sizing: border-box; width: 100%; height: 36px; padding: 0 12px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; }
.dshwl-input::placeholder { color: var(--dsw-alias-label-secondary); }
.dshwl-input:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dshwl-actions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
.dshwl-button { box-sizing: border-box; min-width: 72px; height: 32px; padding: 0 14px; border: 0; border-radius: 8px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground, #fff); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
.dshwl-button:hover:not(:disabled) { opacity: .9; }
.dshwl-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshwl-button:disabled { cursor: default; opacity: .55; }
.dshwl-status { margin: 0; font-size: 12px; line-height: 18px; }
.dshwl-status[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
.dshwl-status[data-kind="success"] { color: var(--dsw-alias-state-success-primary); }
.dshwl-address { margin: 0; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 18px; }
.dshwl-muted { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
`

    function errorText(t, code) {
      switch (code) {
        case 'wrong-password':
          return t('errorWrongPassword')
        case 'weak-password':
          return t('errorWeak')
        case 'invalid-username':
        case 'missing-username':
          return t('errorUsername')
        case 'missing-current-password':
          return t('errorMissingCurrent')
        case 'account-unreadable':
        case 'write-failed':
        case 'verify-failed':
        case 'internal-error':
        case 'bad-request':
        case 'unsupported-media-type':
          return t('errorServer')
        default:
          return t('errorServer')
      }
    }

    function readJson(response) {
      return response.json().catch(() => null)
    }

    function WebLoginSection({ t }) {
      const [phase, setPhase] = React.useState('loading')
      const [configured, setConfigured] = React.useState(false)
      const [username, setUsername] = React.useState('')
      const [currentPassword, setCurrentPassword] = React.useState('')
      const [newPassword, setNewPassword] = React.useState('')
      const [confirmPassword, setConfirmPassword] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        fetch('./dsh-login/account', {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        })
          .then(async (response) => ({ status: response.status, body: await readJson(response) }))
          .then(({ status, body }) => {
            if (cancelled) return
            if (status === 401) {
              setPhase('expired')
              return
            }
            if (body === null || body.ok !== true) {
              setPhase('error')
              return
            }
            setConfigured(body.configured === true)
            setUsername(typeof body.username === 'string' ? body.username : '')
            setPhase('ready')
          })
          .catch(() => {
            if (!cancelled) setPhase('error')
          })
        return () => {
          cancelled = true
        }
      }, [])

      const address = React.useMemo(() => {
        try {
          return new URL('./', window.location.href).href
        } catch {
          return window.location.origin + '/'
        }
      }, [])

      const submit = async (event) => {
        event.preventDefault()
        if (busy || phase !== 'ready') return
        const trimmed = username.trim()
        if (trimmed === '') {
          setNotice({ kind: 'error', text: t('errorMissingUsername') })
          return
        }
        if (trimmed.length > 64) {
          setNotice({ kind: 'error', text: t('errorUsername') })
          return
        }
        if (configured && currentPassword === '') {
          setNotice({ kind: 'error', text: t('errorMissingCurrent') })
          return
        }
        const wantsNewPassword = newPassword !== '' || confirmPassword !== ''
        if (!configured && !wantsNewPassword) {
          setNotice({ kind: 'error', text: t('errorMissingNew') })
          return
        }
        if (wantsNewPassword) {
          if (newPassword === '') {
            setNotice({ kind: 'error', text: t('errorMissingNew') })
            return
          }
          if ([...newPassword].length < 8) {
            setNotice({ kind: 'error', text: t('errorWeak') })
            return
          }
          if (newPassword !== confirmPassword) {
            setNotice({ kind: 'error', text: t('errorMismatch') })
            return
          }
        }

        setBusy(true)
        setNotice(null)
        try {
          const response = await fetch('./dsh-login/account', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              username: trimmed,
              currentPassword: configured ? currentPassword : undefined,
              newPassword: wantsNewPassword ? newPassword : undefined,
            }),
          })
          const body = await readJson(response)
          if (response.status === 401) {
            setPhase('expired')
            return
          }
          if (!response.ok || body === null || body.ok !== true) {
            setNotice({ kind: 'error', text: errorText(t, body?.error) })
            return
          }
          setConfigured(true)
          setUsername(typeof body.username === 'string' ? body.username : trimmed)
          setCurrentPassword('')
          setNewPassword('')
          setConfirmPassword('')
          setNotice({ kind: 'success', text: t('saved') })
        } catch {
          setNotice({ kind: 'error', text: t('errorNetwork') })
        } finally {
          setBusy(false)
        }
      }

      const field = (id, label, value, onChange, options, key) =>
        h('label', { className: 'dshwl-field', htmlFor: id, key }, [
          h('span', { className: 'dshwl-label', key: 'label' }, label),
          h('input', {
            key: 'input',
            id,
            className: 'dshwl-input',
            value,
            onChange: (event) => onChange(event.target.value),
            ...options,
          }),
        ])

      let content
      if (phase === 'loading') {
        content = h('p', { className: 'dshwl-muted' }, t('loading'))
      } else if (phase === 'expired') {
        content = h('p', { className: 'dshwl-status', 'data-kind': 'error', role: 'status' }, t('sessionExpired'))
      } else if (phase === 'error') {
        content = h('p', { className: 'dshwl-status', 'data-kind': 'error', role: 'status' }, t('loadFailed'))
      } else {
        content = h(
          'form',
          { className: 'dshwl-form', onSubmit: submit },
          [
            field('dshwl-username', t('username'), username, setUsername, {
              type: 'text',
              autoComplete: 'username',
              maxLength: 64,
              spellCheck: false,
              required: true,
            }, 'username'),
            configured
              ? field('dshwl-current', t('currentPassword'), currentPassword, setCurrentPassword, {
                  type: 'password',
                  autoComplete: 'current-password',
                  required: true,
                }, 'current')
              : null,
            field(
              'dshwl-new',
              configured ? t('newPasswordOptional') : t('newPassword'),
              newPassword,
              setNewPassword,
              {
                type: 'password',
                autoComplete: 'new-password',
                required: !configured,
              },
              'new',
            ),
            field('dshwl-confirm', t('confirmPassword'), confirmPassword, setConfirmPassword, {
              type: 'password',
              autoComplete: 'new-password',
              required: !configured,
            }, 'confirm'),
            h('div', { className: 'dshwl-actions', key: 'actions' }, [
              notice === null
                ? null
                : h(
                    'p',
                    {
                      key: 'status',
                      className: 'dshwl-status',
                      'data-kind': notice.kind,
                      role: 'status',
                      style: { marginRight: 'auto' },
                    },
                    notice.text,
                  ),
              h(
                'button',
                { key: 'save', type: 'submit', className: 'dshwl-button', disabled: busy },
                busy ? t('saving') : t('save'),
              ),
            ]),
          ],
        )
      }

      return h('section', { className: 'dshwl-section', 'aria-label': t('nav') }, [
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'dshwl-card', key: 'account' }, [
          h('div', { className: 'dshwl-head', key: 'head' }, [
            h('h2', { className: 'dshwl-title', key: 'title' }, t('title')),
            h('p', { className: 'dshwl-desc', key: 'description' }, t('description')),
          ]),
          h('p', { className: 'dshwl-hint', key: 'hint' }, configured ? t('changeHint') : t('setupHint')),
          content,
        ]),
        h('div', { className: 'dshwl-card', key: 'address' }, [
          h('div', { className: 'dshwl-head', key: 'head' }, [
            h('h2', { className: 'dshwl-title', key: 'title' }, t('address')),
            h('p', { className: 'dshwl-hint', key: 'description' }, t('addressHint')),
          ]),
          h('p', { className: 'dshwl-address', key: 'url' }, address),
          h('p', { className: 'dshwl-hint', key: 'token' }, t('tokenHint')),
        ]),
      ])
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'web-login: en dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'web-login: zh dictionary')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-web-login',
              order: 25,
              label: () => t('nav'),
              locale: NS,
            },
            WebLoginSection,
          ),
        )
      },
    }
  },
})
