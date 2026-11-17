# dsh-web-login

**中文** | [English](README.md)

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-4B8BBE)](https://github.com/deepseek-ai/deepseek-harness)
[![Node](https://img.shields.io/badge/node-%E2%89%A524.9-339933)](https://nodejs.org)

DSH（DeepSeek Harness）Web 界面的账号密码登录插件。用一个全局账号替代启动 token 链接：任何设备打开网页先看到登录页，登录成功后获得 DSH 原生会话 Cookie（默认 30 天）。

## 特性

- **全局唯一账号** —— 所有设备共用同一个用户名和密码。
- **不用再复制 token** —— 日常只记密码；token 链接保留为找回密码的通道。
- **网页内管理** —— 在 **设置 → Web 登录** 中修改账号或密码，需验证当前密码。
- **安全存储** —— scrypt 加盐哈希（N=16384, r=8, p=1），账号文件权限 `0600`。
- **失败限速** —— 同一 IP 每分钟最多 5 次失败尝试，超出返回 `429`。
- **复用原生会话** —— 完全走 DSH 的 token 交换与签名 Cookie，不重写任何 Cookie 逻辑。
- **中英双语** —— 登录页跟随 `Accept-Language`，设置页跟随 DSH 界面语言。

## 安装

```sh
dsh plugin --profile web add github:simpleobj/dsh-web-login
```

然后确认 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 中包含 `dsh-web-login`：

```jsonc
{
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-web-login"] } }
}
```

重启 `dsh web`，打开 `http://<host>:<port>/`。尚未创建账号时登录页会显示「创建账号」，否则要求登录。

环境要求：DSH 0.2.x，Node.js ≥ 24.9。

## 使用

| 操作 | 方法 |
| --- | --- |
| 登录 | 打开 `http://<host>:<port>/`，输入账号密码 |
| 修改账号 / 密码 | **设置 → Web 登录**，需输入当前密码 |
| 忘记密码 | 用 `dsh web` 启动时打印的 token 链接登录，再到 **设置 → Web 登录** 重设；或删除 `~/.dsh/web-login.json` 重新设置 |

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | DSH 数据目录，账号文件放在这里 |
| `DSH_WEB_LOGIN_FILE` | `$DSH_HOME/web-login.json` | 自定义账号文件路径 |

## 安全说明

- 账号文件只保存加盐 scrypt 哈希，不保存明文密码。
- 建议启用 TLS；纯 HTTP 部署请把端口限制在可信网络内。
- 修改密码**不会**使其他设备已登录的会话立即失效 —— 它们持有的 Cookie 到期前仍有效。需要全部失效时，删除 `$DSH_HOME/.credentials.yaml` 中 `client-connection/browser-session` 记录并重启 dsh。
- 单实例单账号，这是设计取舍。

## 排查

- **提交后 `403 forbidden`** —— 被 DSH 的 Host/Origin 围栏拒绝。确认浏览器地址与 `dsh web --trusted-host` 一致（例如 `--trusted-host 1.2.3.4:3080`）。另外，浏览器在刷新后重新提交表单时可能发送 `Origin: null`，当前版本已兼容。
- **`429`** —— 触发登录限速，按响应头 `Retry-After` 秒数等待后重试。
- **访问 `/dsh-login/authenticate` 返回 `405`** —— 正常，该地址只接受登录页发起的 POST。

## License

[MIT](LICENSE)
