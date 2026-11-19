# Local Workflow Agent Instructions

## Two rules that outrank the rest of this file

这两条优先于本文件其它约定。违反它们比写错代码更严重；仓库根 `AGENTS.md` 有同样的规则，适用于全仓。

### 1. 先本地跑通，再交付

任何变更必须在本机验证通过才算做完。禁止“写完直接打包/构建去验证”——反馈太慢，且掩盖局部错误。

本目录的验证入口就是下面 `Validation` 节的脚本：先跑与改动相关的那几个，全过了再谈交付。它们都是 Python / Shell，在本机直接可跑，不需要交叉编译或容器。

### 2. 新增代替改写：旧逻辑一行不动

变更已有功能时，优先**新增一份平行实现**，而不是修改旧代码的语义。旧功能保持原样，新功能与它并存。

在本目录具体表现为：

- **Classic 与 Portable 是两份平行实现**，不是一份的改写。改 Classic 的行为不会自动改 Portable，反之亦然；共享的是行为契约和测试，不是运行时文件。这与“新增代替改写”是同一件事。
- **`.cursor` / `.claude` 是 `.codebuddy` 的生成产物**，不能直接编辑；要改就改源，再 `build-classic-hosts.py --write` 重新生成。
- **`tools/tcmcp/` 是独立可选工具**，不要把它混进任何一版的运行时。
- **共享路径上的修改要格外谨慎**：改动 `manifest.json` 里的角色、产物或规则会影响所有调用方。需要新行为时，加新条目或新字段，不要改既有条目的含义。
- **测试是契约**：既有检查失败时，先判断是新需求还是真 bug。为了让自己改动通过而改现有断言，等于悄悄改需求，必须有明确的用户确认。

代价是代码量增加，接受这个代价：保留旧行为带来的安全感，比省几百行更重要。

## Source of truth

- Local workflows have two editions: Classic (`.codebuddy/.codex/.cursor/.claude`) and Portable (`skills/`). Do not mix their runtime assets.
- Treat `.codebuddy` as the Classic reference behavior. `.cursor` and `.claude` are generated Classic host bundles; do not edit them directly.
- Treat `skills/devflow/` and `skills/devflow-clarify-requirements/` as the canonical Portable workflow.
- Treat `tools/tcmcp/` as an independent optional tool (Python 3.11+). Do not mix it into Classic or Portable edition runtime files.
- Keep logical roles in `skills/devflow/agents/manifest.json`, artifacts in `skills/devflow/templates/manifest.json`, rules in `skills/devflow/rules/manifest.json`, and host capabilities in each `skills/devflow/adapters/<host>/manifest.json`.
- After changing Classic behavior or host adaptation, run `python3 scripts/build-classic-hosts.py --write`.
- A Classic change is not automatically a Portable change. Share explicit behavior contracts and tests, not runtime files.

## Validation

Run these commands before reporting a workflow change complete:

```bash
python3 scripts/build-classic-hosts.py --check
bash scripts/validate.sh
bash scripts/smoke-install.sh
bash scripts/e2e.sh
bash scripts/test-observability.sh
bash scripts/scan-secrets.sh
```

Preserve user changes, do not commit secrets or organization-specific infrastructure, and distinguish passed, failed, blocked, and not-run checks.
