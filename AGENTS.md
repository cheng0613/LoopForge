# LoopForge platform

Preserve the platform architecture; keep deployment-specific adapters isolated. Detailed source synchronization records are maintained locally and are not required for community changes. The original local workflow runtime lives in `local/`; follow `local/AGENTS.md` there. Never copy private deployment files, credentials, staff data, or internal infrastructure into this repository.

# AGENTS.md

本文件面向所有在仓库内工作的 AI agent 与人类贡献者，约定 repo 层与 handler 层的结构规则。
新增代码必须遵守；发现历史偏差时先归位再继续。

## 铁律：本地验证 + 新增代替改写

这两条优先于本文件的其它约定。违反它们比写错代码更严重。

### 1. 先本地跑通，再交付

任何功能变更或新增，必须在本机验证通过，才算做完。禁止“写完代码直接打包/重建镜像去验证”——反馈太慢，且掩盖局部错误。

验证顺序：

1. 编译：`GOOS=linux go build ./internal/...`（本机 Windows 缺 Unix syscall，只能交叉编译）。
2. 后端测试：`./scripts/gotest.sh ./internal/<包>/ -test.run <用例>`，改动波及多个包时逐个跑。
3. 前端：`node scripts/web-dev-server.js` 起磁盘版 web，再用 Electron 打开看真实渲染；不要靠改完等镜像重建。
4. 端到端：只有在 1–3 全过后，才考虑重建镜像跑完整链路。

后端测试在本机跑不了是已知限制（`syscall.Kill` 等 Unix-only），`scripts/gotest.sh` 用交叉编译 + 容器执行绕开，几秒出结果。用它，不要每次重建镜像。

### 2. 新增代替改写：旧逻辑一行不动

变更已有功能时，优先**新增一份平行实现**，而不是修改旧代码的语义。旧功能保持原样，新功能与它并存。

判断标准：

- **角色/伙伴这类核心资产**：新增表、接口、视图，不改原表的语义或既有字段含义。参考全局伙伴——新表 `global_partners`、新端点 `/api/global-partners`、新视图 `partners`，`agents` 的语义一行没动。
- **其它既有功能**：同样优先新增。只有当“保留旧行为”本身就是错误（例如安全问题、数据损坏）时才改写，并在提交信息里说明原因。
- **共享路径上的修改要格外谨慎**：像 `filterAgentsForProject`、`workflowAgent` 这样被所有调用方使用的函数，改它等于改全部功能。需要新行为时，加参数、加新函数或加回退分支，不要改原分支的判断。
- **测试是契约**：既有测试失败时，先判断是新需求还是真 bug。为了让自己代码通过而改既有断言，等于悄悄改需求，必须有明确的用户确认。

代价是代码量增加，接受这个代价：保留旧行为带来的安全感，比省几百行更重要。

### 3. 仓库是 LF，提交前检查行尾

仓库里所有源文件用 **LF**（`.gitattributes` 只对生成产物做了约定，其余靠约定
保持）。在 Windows 上用编辑器/工具改文件时会不小心写成 CRLF，后果是整个文件
在 diff 里变成“每一行都改了”，把真实改动埋在一万行噪声里，review 无法进行。

这不是理论风险：`internal/domain/`、`web/product-v4.css`、`chatbot/src/App.jsx`、
`AGENTS.md` 都发生过一次。典型触发点是 `gofmt -w` 加整个目录、或在 Windows
工具里重写整个文件。

提交前必做：

```bash
git diff --stat          # 先看改动规模，整文件行数跳变就是可疑
file <改过的文件>        # 出现 "with CRLF line terminators" 即被污染
git diff | grep -c $'\r' # 非 0 说明 diff 里混了 CRLF
```

发现污染时转回 LF 再提交：

```bash
sed -i 's/\r$//' <文件>
```

另一个坑：`gofmt -w <目录>/` 会把整个包里**所有**文件重写一遍，即使只有
一个文件有逻辑改动。所以只对改过的文件跑 gofmt，不要对目录跑；真被重写了
就用 `git checkout -- <未改动的文件>` 逐个还原，只留真实改动。

## repo 层（internal/repo）

每个领域一个 Repo，文件与方法一一归属：

| 领域 Repo | 拥有 |
|---|---|
| `CatalogRepo` | agents/rules/skills/MCP servers/executors/dockerfiles/environments/sandboxes/workflows/repositories/sync config/schedule jobs/definition revisions/generic templates |
| `ProjectsRepo` | projects、project members |
| `IssuesRepo` | issues、issue comments |
| `TasksRepo` | tasks（跨实例幂等记录） |
| `UsersRepo` | users、credentials（含平台共享 CodeBuddy Key）、platform admins |
| `TokensRepo` | API tokens |
| `AssistantRepo` | Studio 助手会话、定时 prompts |
| `RunsRepo` | runs 及其子资源、run leases、workflow metrics、run evals |
| `RunnersRepo` | CLI runner 注册表、runner tasks/events |
| `DeliveryRepo` | MR delivery 状态与锁 |
| `AnalyticsRepo` | 只读运营分析视图 |
| `PreviewsRepo` | run previews |
| `EngineInstancesRepo` | engine instances |
| `FeedbackRepo` | page feedbacks、page feedback images（独立表，不关联项目/Issue） |

规则：

1. **禁止在 `Store` 上新增领域方法。** `Store`（repo.go）只做两件事：
   - 组合各领域 Repo（匿名嵌入）与连接生命周期（`Open`/`Close`）；
   - 必须跨领域合并的视图（现已全部降级进领域 Repo，如
     `CatalogRepo.Workflow`/`Workflows` 合并 generic_templates）。
   - 合并视图的行为契约：`CatalogRepo.Workflows` 先按 `UpdatedAt` 排序
     workflows 表行，generic 模板恒追加在尾部（不得混入排序）；
     `Workflow(id)` generic 模板优先于同 ID 物理行；写路径
     （`PutWorkflow`/`DeleteWorkflow`）经 `storedWorkflow` 只看物理表。
2. 新实体先找所属领域 Repo；确实没有就新建一个 `XxxRepo`，并在 `newStore`
   中装配。领域间协作用 `newStore` 里的显式指针注入（如 `RunsRepo` 持有
   `issues`/`catalog`），不允许循环依赖。
3. 领域 Repo 的共享依赖只有 gorm 句柄（`deps`），不要往 `deps` 加别的。
4. 写一个文件挂多个领域 receiver 是坏味道；同一领域的方法可分布在多个文件
   （如 `runs.go`/`run_evals.go` 都属 `RunsRepo`），但文件不得为其他领域定义方法。

## 迁移与 seed（migrations/）

1. **代码不做迁移、不做 seed。** `repo.Open()` 只负责连接和 gorm
   AutoMigrate 的增量 DDL（补缺失的表/列/索引）。基线 schema、数据迁移
   （改数据、删行、删列）和 seed 数据一律写成 `migrations/` 下的 SQL
   脚本，由运维**手动执行**，部署时不会自动跑。
2. 每个分支自带自己的迁移脚本，不做任何自动化生成（没有 seedgen 之类的
   工具）。脚本命名 `NNN_描述.sql`，按序号递增。
3. 禁止新增 `ensureXxx`/`migrateXxx`/`seedXxx` 之类的启动自愈逻辑写入
   生产路径。测试专用的默认数据只存在于 `internal/repo/opentest.go`
   （`OpenTest`，仅测试调用，生产代码不得引用）。
4. **生成列（`GENERATED ALWAYS AS … STORED`）AutoMigrate 补不了**，因为
   gorm 的模型只描述普通列。迁移 001 的 `run_telemetry.adapter` 和
   `run_logs.level` 属于这类，缺了会在运行详情/统计时报
   `Error 1054 Unknown column 'adapter'`。它们由
   `scripts/install-observability-schema.sh` 幂等补齐（含存在性检查），
   不要用裸 `ALTER` 重跑——MySQL 8.0 没有 `ADD COLUMN IF NOT EXISTS`。

## 部署检查清单

换库、换机器、重建 volume 后，逐条确认。跳过任何一条都会以"功能报错"
的形式暴露，而不是以"迁移没跑"的形式——排查成本高很多。

1. `bash scripts/install-schema-extensions.sh`
   一次性覆盖三件事：生成列（001）、种子目录（`migrations/seed/*.sql`）、
   内置 Dockerfile（031）。幂等，可重复执行；`./start.sh pull` 也会跑。
2. 确认生成列真的在：
   ```sql
   SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema='loopforge' AND column_name IN ('adapter','level');
   ```
   应为两行。缺失时 SOP 流程、运行详情、统计聚合都会 1054。
3. 冒烟三条读生成列的路径：
   - `GET /api/runs/<id>/telemetry?adapter=all`
   - `GET /api/runs/<id>/telemetry?adapter=hooks`（以及 `otel`/`live`/具体值）
   - `GET /api/analytics?range=30d`

## handler 层（internal/httpapi）

1. 每个领域一个 handler struct（`authHandlers`、`usersHandlers`、
   `catalogHandlers`、`issuesHandlers`、`tasksHandlers`、`runsHandlers`、
   `previewsHandlers`、`streamHandlers`、`runnersHandlers`、
   `scheduleHandlers`、`tokenHandlers`、`syncHandlers`、
   `assistantHandlers`、`mcpHandlers`、
   `marketHandlers`、`feedbackHandlers`…），在 `server.go` 的 `Server` 中以指针装配。
2. **新领域必须新建自己的 handler struct**，不要把方法挂到现有领域 handler
   或 `Server` 上。
3. 同一领域的多个文件允许（`run_eval.go`/`run_workspace.go` 属
   `runsHandlers`），但一个文件不得为别的领域 handler 定义方法。
   纯共享的包级 helper（无 receiver）可以放独立 helper 文件。
4. `Server` 只保留服务级端点与入口装配（`health`、`capabilities`、
   `openAPI`、`bootstrap`、`observabilitySpec`、`otel` 等）。
5. 跨领域协作走显式注入（如 `issuesHandlers` 持有 `tasks`/`stream`），
   与 repo 层同构。

## 前端设计参考（chatbot/、web/）

1. 前端改动先读根目录 `design.md`，沿用其中的布局、图标、动效与交付约定。
2. 视觉结构与布局参考 Grasp（MIT，许可见 `chatbot/src/assets/provider-logos/LICENSE.grasp`）。
3. 图标、动效与组件设计语言参考 Harness UI（MIT，许可见 `web/app/harness-ui-LICENSE.txt`）。
4. 引入上游素材或代码时保留 MIT 许可与来源说明，许可文件位置见
   `design.md`「设计参考」。

## 历史整改记录

- 2026-09：`platform_admin.go` 全部并入 `UsersRepo`；`generic_store.go`
  模板 CRUD 并入 `CatalogRepo`；`run_preview.go` 拆出 `previewsHandlers`
  （runner 侧上传端点归还 `runners.go`）；`agent_tool_native.go` 的领域
  方法归还 `assistant.go`/`clarify_mcp.go`，只留包级 helper；
  `Workflow`/`Workflows` 合并视图降级进 `CatalogRepo`（写路径经
  `storedWorkflow` 只看物理表）；删除全部代码内 seed/数据迁移
  （`seed`/`ensureGenericDockerDefaults`/`ensurePlatformAdmins`/
  `migrateLegacyProjectTapd`），`Open` 只留连接 + gorm AutoMigrate，
  `migrations/` 清空为手动 SQL 脚本目录，测试默认数据移入
  `internal/repo/opentest.go`。
