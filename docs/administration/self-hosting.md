---
title: Self-Hosting
---

# Self-Hosting

Routa can be used as a packaged Desktop app, but the web/runtime surface can also be run in your
own environment.

## What Self-Hosting Means Today

Today, self-hosting is primarily about running the Next.js web surface and, when needed, wiring
it to a local or remote backend/runtime.

## Basic Local Flow

Run the web surface from source:

```bash
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`.

If you want the web UI to point at a local backend:

```bash
ROUTA_RUST_BACKEND_URL="http://127.0.0.1:3210" npm run dev
```

## Operational Concerns

The main things to think about are:

- which provider paths are available
- which environment variables are set
- whether the backend/runtime surface is reachable from the web UI
- whether Docker-backed execution paths are available when required

### Network Exposure (loopback only)

生产实例只监听 127.0.0.1，局域网访问被拒；要远程用请走 SSH 隧道。

`npm start` runs `next start -H 127.0.0.1`, so the production server only accepts connections from
this machine (`http://127.0.0.1:3000` and `http://localhost:3000` both work; the LAN IP and
`[::1]` are refused). Routa has no login check, so anyone who can reach the port can read every
board and trigger agent dispatch — keep it on loopback.

To use it from another machine, open an SSH tunnel:

```bash
ssh -L 3000:127.0.0.1:3000 <用户>@<主机>
```

Then open `http://127.0.0.1:3000` locally. SSH 隧道等于把看板和派活权限交给能登录这台机器的人：
any tunnel or reverse proxy on this host (`ssh -L`, frp, nginx) re-exposes the server, and the
forwarded requests look like loopback traffic to Routa. Do not put a reverse proxy in front of it.

Self-call fallbacks (background worker, MCP URLs handed to spawned agents, orchestrator delegation,
ACP request origin) default to `http://127.0.0.1:${PORT}` so they keep working with a loopback-only
bind; `HOST`, `ROUTA_SERVER_URL`, `NEXTAUTH_URL` and `VERCEL_URL` still override them where they did
before. Docker-backed agents that reach the host via `host.docker.internal` cannot connect to a
127.0.0.1-only server (not handled yet).

## What This Is Not Yet

The repository currently has stronger release and contributor docs than full public production
self-hosting runbooks. Treat this page as the operational entry point, not as a complete hosting
manual.

## Read Next

- [Configuration](/configuration)
- [Deployment](/deployment)
- [Release Guide](/release-guide)

## 变更记录

| 日期 | 改了什么 | 效果 | 提交号 |
|---|---|---|---|
| 2026-10-24 | `npm start` 改为 `next start -H 127.0.0.1`；5 处自连回落值和 ACP 请求来源地址统一为 127.0.0.1（复盘 L127） | 局域网 IP:3000 连接被拒（curl 退出码 7），本机 127.0.0.1 / localhost 仍返回 200；交给施工者的 MCP 地址不再是 localhost | 本提交 |
