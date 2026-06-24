---
title: 配置总览
hide_table_of_contents: true
---

# 配置

Routa 中的配置主要是为了让执行变得可用且可预测。

最重要的配置领域包括：

- providers
- models
- 角色默认值
- 环境变量

## 推荐的设置顺序

1. 让一个 Provider 可用。
2. 如果该 Provider 需要明确的模型目标，则添加或选择一个模型。
3. 为你关心的角色绑定默认值。
4. 回到工作区并运行一个 `Session`。

## 从这里开始

- [Providers 与 Models](/configuration/providers-and-models)
- [环境变量](/configuration/environment-variables)

## 快速设置路径

<div className="routa-start-grid">
  <div className="routa-start-card">
    <span className="routa-start-card__badge">必需</span>
    <h3>Providers 与 Models</h3>
    <p>让一个 Provider 可用，并将一个角色指向一个可正常工作的模型。</p>
    <a className="routa-inline-link" href="/routa/configuration/providers-and-models">打开 Providers 与 Models</a>
  </div>
  <div className="routa-start-card">
    <span className="routa-start-card__badge">可选</span>
    <h3>环境变量</h3>
    <p>当本地运行时接线或部署需要明确的环境变量值时使用。</p>
    <a className="routa-inline-link" href="/routa/configuration/environment-variables">打开环境变量</a>
  </div>
</div>

## 产品上下文

在产品 UI 中，配置界面目前主要围绕以下内容：

- `Providers`
- `Registry`
- `Role Defaults`
- `Models`

这些设置决定了哪个 Provider 可用、模型端点如何被解析，以及 Routa 为
`ROUTA`、`CRAFTER`、`GATE` 和 `DEVELOPER` 等角色使用的默认值。

## 实用规则

不要试图在第一次运行之前就配置好每一个 Provider。一个可正常工作的 Provider 和一条
可正常工作的模型路径就足够了。
