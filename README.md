# dsh-web-login

**用账号密码登录 DSH Web，替代每次复制启动 token 链接。**

[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的 Web 界面默认通过进程启动时打印的 `?token=` 链接来认证浏览器。本插件在 token 交换之前加了一层**全局唯一的用户名/密码账号**：任何设备打开网页时先看到登录页，登录成功后才签发正常的 DSH 会话 Cookie。

```
未登录浏览器 ──▶ 登录页 ──▶ 校验账号密码 ──▶ 303 到 ?token= 链接 ──▶ DSH 签发会话 Cookie ──▶ 进入 Web 界面
```

> 状态：可用。面向 DSH developer preview（0.2.x）开发，核心接口如有变动会跟进。

---

## 功能特性

- **全局唯一账号**：一台实例一个用户名 + 一个密码，所有设备共用。
- **替代 token 登录**：日常使用只需要记密码，不再翻终端找 token 链接。
- **会话持久**：登录成功后获得 DSH 原生签名 Cookie（默认 30 天），期间打开页面直接进入。
- **网页内管理**：**设置 → Web 登录** 中修改账号或密码，改密码需要验证当前密码。
- **安全存储**：密码以 scrypt 加盐哈希保存，不存明文；账号文件权限 `0600`。
- **失败限速**：同一来源 IP 60 秒内最多 5 次失败尝试，超出返回 `429`。
- **中英双语**：登录页跟随浏览器 `Accept-Language`，设置页跟随 DSH 界面语言。
- **不重造轮子**：不复制任何 Cookie 签名/校验逻辑，完全复用 DSH 的 token 交换与会话机制。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| DSH | developer preview，0.2.x（用到了 `connection.authorizeIndex`、`connection.requestRejection`、`webServer.register`） |
| Node.js | ≥ 24.9（DSH 本身的运行要求） |
| 网络 | 与 DSH Web 同源部署；如经反向代理，需把对外 authority 加进 `dsh web --trusted-host` |

## 安装

### 从 GitHub 安装（推荐）

```bash
dsh plugin --profile web add github:<你的用户名>/dsh-web-login
```

### 从本地源码安装（开发调试）

```bash
dsh plugin --profile web add link:/绝对路径/dsh-web-login
```

安装后在 profile 的 `package.json`（默认 `~/.dsh/profiles/web/package.json`）中确认两点：

1. `dependencies` 里出现 `"dsh-web-login"`；
2. `dsh.profile.bundles` 数组里包含 `"dsh-web-login"`（否则插件的 `cordis.patch.yml` 不会参与组装）。

```jsonc
{
  "dependencies": { "dsh-web-login": "github:you/dsh-web-login" },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-web-login"]
    }
  }
}
```

最后重启 `dsh web`，插件即生效。

## 首次设置

插件装好但还没有账号时，任选一种方式创建（两种方式效果相同）：

1. **登录页创建（推荐）**：未登录的浏览器打开 `http://<host>:<port>/`，会出现「创建账号」页面，填写账号和密码后自动登录。
2. **设置页创建**：用已登录的浏览器打开 设置 → **Web 登录**，填写后保存。

> 创建账号的入口只在**账号尚不存在**时开放，请尽快完成首次设置，避免他人抢先创建。

密码最小长度 8 个字符，最长 512；用户名 1–64 个字符。

## 日常使用

- **登录**：打开 `http://<host>:<port>/`，输入账号密码。
- **修改账号 / 密码**：设置 → **Web 登录**，输入当前密码后保存；新密码留空表示保持不变。
- **忘记密码**：
  1. 用 `dsh web` 启动时打印的 token 链接打开页面（token 链接始终可用作恢复通道）；
  2. 进入 设置 → **Web 登录** 重设密码。
  - 也可以在 Host 上删除账号文件后重新走首次设置：

  ```bash
  rm ~/.dsh/web-login.json
  ```

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | DSH 数据目录，账号文件默认放在这里 |
| `DSH_WEB_LOGIN_FILE` | `$DSH_HOME/web-login.json` | 账号文件路径，优先于 `DSH_HOME`，便于测试或多实例隔离 |

## 安全模型

| 项目 | 说明 |
| --- | --- |
| 账号文件 | `$DSH_HOME/web-login.json`，权限 `0600`，仅存哈希 |
| 密码哈希 | scrypt（N=16384, r=8, p=1）+ 16 字节随机盐，64 字节输出 |
| 会话 | 复用 DSH 的启动 token 交换与签名 Cookie，有效期沿用 DSH 的 `cookieMaxAgeDays`（默认 30 天） |
| 时序 | 用户名错误与密码错误都执行一次 scrypt，避免通过耗时区分 |
| 请求体 | 上限 16 KiB，超出返回 `413` |
| 传输 | 监听器启用 TLS 时 Cookie 自动带 `Secure`；**纯 HTTP 部署请自行限制端口暴露范围** |

### 已知限制

- **只有一个账号**，这是有意为之（单实例单管理员）。
- **改密码不会踢掉已登录的其他设备**：它们持有的 Cookie 在过期前仍然有效。需要强制全部失效时，删除 `$DSH_HOME/.credentials.yaml` 中 `client-connection/browser-session` 记录并重启 dsh。
- 失败计数在进程重启后清零。
- 插件只负责"入口认证"，**不改变 DSH 本身的能力边界**：登录后的用户即 owner，拥有完整工具权限。

## 排查

**登录提交后返回 403 `forbidden`**
这是 DSH 的 Host/Origin 安全围栏在拒绝请求，常见原因有两种：

1. **访问地址未被信任**：浏览器地址栏的 host:port 必须是 `dsh web --trusted-host` 声明过的地址（或回环地址/绑定地址）。例如通过 `http://1.2.3.4:3080` 访问，启动参数里就要有 `--trusted-host 1.2.3.4:3080`。
2. **浏览器提交了 `Origin: null`**：F5 刷新后重新提交表单、部分重定向链、或隐私扩展清洗请求头时会这样。本插件已兼容该场景：对 `Origin: null` 会去掉 Origin 头再做一次围栏判定，Host 不可信或 `Sec-Fetch-Site: cross-site` 的请求依然会被拒绝。如果你用的是旧版本，请升级本插件。

抓包确认方法（在 Host 上）：

```bash
tcpdump -i any -nn -A 'tcp port 3080' | grep -A8 'POST /dsh-login'
```

**打开登录页正常，但登录后一直停在登录页**
检查浏览器是否启用了严格 Cookie 策略/隐私模式，以及访问地址与登录地址是否完全一致（Cookie 按 authority 绑定，`IP` 与域名之间不共享会话）。

**返回 429**
触发登录限速，等待响应头 `Retry-After` 秒数后重试。

**直接访问 `/dsh-login/authenticate` 返回 405**
正常现象：该地址只接受 `POST`，请从登录页提交。

## 实现说明

**Host 半（`index.js`）**

- 包装 `ctx.connection.authorizeIndex`：未携带有效 Cookie 的 `GET /` / `GET /index.html` 改由插件返回登录页；带 `?token=` 的请求仍交给 DSH 原生 token 交换。因此不复制任何 Cookie 签名逻辑。
- 注册三个精确路由：
  - `POST /dsh-login/authenticate` — 校验账号密码，成功后 `303` 到 `../?token=...`（相对路径，兼容前缀剥离代理）；
  - `POST /dsh-login/setup` — 仅在账号不存在时创建；
  - `GET|POST /dsh-login/account` — 设置页接口，要求有效浏览器会话。
- 所有写接口先过 DSH 的 Host/Origin 围栏（`connection.requestRejection`），并对 `Origin: null` 做安全等价的二次判定。

**Client 半（`client.js`）**

- 通过 `ctx.slots` 在 `settings.section` 注册「Web 登录」页面；
- 通过同源 `fetch` 调用 `/dsh-login/account`；
- 样式仅使用 `--dsw-alias-*` 主题变量，跟随 DSH 明暗主题。

## 目录结构

```
package.json        插件与 bundle 清单
cordis.patch.yml    向 profile 插入 dsh-web-login
index.js            Host：登录页、账号校验、设置接口
client.js           Client：设置分区
icon.svg            插件图标
locale/en.json      插件列表中的英文标题/描述
locale/zh.json      插件列表中的中文标题/描述
README.md
```

## 卸载

```bash
dsh plugin --profile web remove dsh-web-login
```

如需同时清除账号数据：

```bash
rm ~/.dsh/web-login.json
```

卸载后 DSH 回到原生 token 登录方式。

## License

MIT
