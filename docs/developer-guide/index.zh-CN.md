---
title: 开发者指南概览
hide_table_of_contents: true
---

# 开发者指南

本节面向需要更深入评估 Routa、在首次运行路径之外进行配置，或在自有环境中运行 Routa 的开发者。

## 从这里开始

<div className="routa-doc-map">
  <a href="/routa/configuration">
    <strong>配置</strong>
    设置 Provider、模型和环境变量，让 Routa 能够真正运行有用的工作。
  </a>
  <a href="/routa/administration">
    <strong>管理</strong>
    当你为团队或内部环境运维 Routa 时，使用自托管、部署及面向发布的文档。
  </a>
  <a href="/routa/developer-guide/project-structure">
    <strong>项目结构</strong>
    了解桌面端应用、CLI、Web 端运行时和服务端各部分如何协同工作。
  </a>
  <a href="/routa/ARCHITECTURE">
    <strong>架构</strong>
    阅读权威的系统边界、运行时拓扑以及双后端不变量。
  </a>
  <a href="/routa/developer-guide/testing">
    <strong>测试</strong>
    理解自行修改或运行 Routa 时的验证流程与适应度函数层级。
  </a>
  <a href="/routa/developer-guide/local-overlay-sync">
    <strong>本地叠加同步</strong>
    在同时携带仅本地补丁和上游 PR 分支的情况下，保持自托管的 Routa 检出可升级。
  </a>
  <a href="/routa/deployment">
    <strong>部署</strong>
    当你要将 Web 端界面或支撑服务投入真实环境时使用此文档。
  </a>
</div>

## 本节的用途

当你需要超出普通终端用户路径的内容时，使用本节：

- 配置 Provider 和部署环境
- 从技术层面理解各产品界面如何协同
- 在团队或自托管环境中运行 Routa
- 在面向用户的路径已经清晰之后，对 Routa 进行扩展

## 推荐阅读顺序

1. 阅读 [配置](/configuration)，打通一个 Provider 和一条可用的模型路径。
2. 如果你正为团队或内部环境运维 Routa，请阅读 [管理](/administration)。
3. 阅读 [项目结构](/developer-guide/project-structure) 和 [架构](/ARCHITECTURE)，以获取更深入的技术背景。
4. 当你需要验证或发布指引时，阅读 [测试](/developer-guide/testing) 和 [部署](/deployment)。
5. 如果你在本地运行 Routa 并长期保留本地补丁，同时仍需干净的上游更新，请阅读 [本地叠加与上游同步](/developer-guide/local-overlay-sync)。

## 仅面向维护者的材料

大多数读者在第一天并不需要这些内容：

- [代码风格](/coding-style)：仓库变更的实现与测试约定
- [Git 工作流](/developer-guide/git-workflow)：提交与分支纪律
- [贡献指南](/developer-guide/contributing)：Routa 自身的贡献流程
