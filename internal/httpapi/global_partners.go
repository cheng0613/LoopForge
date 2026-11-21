package httpapi

import (
	"net/http"
	"strings"

	"agentflow/internal/domain"
	"agentflow/internal/repo"

	"github.com/gin-gonic/gin"
)

// Global partners: usable from every project, editable only by platform
// administrators. They live in their own table so project partners in `agents`
// keep their existing per-project rules.
//
// A global partner references rules, skills and MCP servers by id; execution
// resolves those ids against the project running the workflow, so each project
// uses its own copies without duplicating the partner definition.

func (h *catalogHandlers) globalPartners(c *gin.Context) {
	if c.Request.Method == http.MethodGet {
		// Readable by any signed-in user: the catalog is what projects bind from.
		c.JSON(http.StatusOK, h.repo.GlobalPartners())
		return
	}

	// Every write changes what all projects run, so it is admin-only.
	if !h.isPlatformAdmin(c.Request) {
		c.JSON(http.StatusForbidden, map[string]string{"error": "只有平台管理员可以编辑全局伙伴"})
		return
	}

	var v domain.AgentDefinition
	if !decode(c, &v) || strings.TrimSpace(v.ID) == "" || strings.TrimSpace(v.Name) == "" {
		c.JSON(http.StatusBadRequest, map[string]string{"error": "伙伴标识和名称不能为空"})
		return
	}
	v.ID = strings.TrimSpace(v.ID)

	// The same validation the project catalog applies, so an unusable executor
	// or an unparsable gate is rejected here rather than at run time.
	if strings.TrimSpace(v.ExecutorID) == "" {
		v.ExecutorID = "codebuddy"
	}
	builtIn, ok := repo.BuiltInExecutor(v.ExecutorID)
	if !ok {
		c.JSON(http.StatusBadRequest, map[string]string{"error": "不支持的 CLI：" + v.ExecutorID})
		return
	}
	if err := domain.ValidateAgentEffort(v.Effort, builtIn.Kind); err != nil {
		c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := domain.ValidateVerificationGates(v.Verification); err != nil {
		c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	// A global partner must not collide with a project partner id: workflows
	// reference a partner by id alone, so a duplicate would shadow one of them.
	if _, taken := h.repo.Agent(v.ID); taken {
		c.JSON(http.StatusConflict, map[string]string{"error": "标识已被项目伙伴使用，请换一个"})
		return
	}
	if current, ok := h.repo.GlobalPartner(v.ID); ok {
		v.Version = current.Version + 1
	}
	if err := h.repo.PutGlobalPartner(v); err != nil {
		respond(c, err)
		return
	}
	stored, _ := h.repo.GlobalPartner(v.ID)
	c.JSON(http.StatusOK, stored)
}

func (h *catalogHandlers) globalPartner(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, map[string]string{"error": "缺少伙伴标识"})
		return
	}

	if c.Request.Method == http.MethodDelete {
		if !h.isPlatformAdmin(c.Request) {
			c.JSON(http.StatusForbidden, map[string]string{"error": "只有平台管理员可以删除全局伙伴"})
			return
		}
		if _, ok := h.repo.GlobalPartner(id); !ok {
			c.JSON(http.StatusNotFound, map[string]string{"error": "全局伙伴不存在"})
			return
		}
		if names := h.workflowNamesUsingGlobalPartner(id); len(names) > 0 {
			c.JSON(http.StatusConflict, map[string]string{
				"error": "伙伴仍被 " + strings.Join(names, ", ") + " 引用，请先解除引用",
			})
			return
		}
		if err := h.repo.DeleteGlobalPartner(id); err != nil {
			respond(c, err)
			return
		}
		c.Status(http.StatusNoContent)
		return
	}

	v, ok := h.repo.GlobalPartner(id)
	if !ok {
		c.JSON(http.StatusNotFound, map[string]string{"error": "全局伙伴不存在"})
		return
	}
	c.JSON(http.StatusOK, v)
}

// workflowNamesUsingGlobalPartner lists workflows whose agent nodes resolve to
// this global partner. A project partner with the same id wins at run time, so
// those references do not count.
func (h *catalogHandlers) workflowNamesUsingGlobalPartner(id string) []string {
	var names []string
	for _, workflow := range h.repo.Workflows() {
		for _, node := range workflow.Nodes {
			if strings.TrimSpace(node.AgentID) != id {
				continue
			}
			if _, projectOwned := h.repo.Agent(id); projectOwned {
				continue
			}
			names = append(names, workflow.Name)
			break
		}
	}
	return names
}
