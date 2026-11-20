package repo

import (
	"errors"
	"sort"
	"strings"
	"time"

	"agentflow/internal/domain"
)

// Global partners belong to no project. Every project can use one, and editing
// it affects all of them, so writes are restricted to platform administrators at
// the HTTP layer.
//
// A global partner stores its rules, skills and MCP servers as ids. Execution
// resolves those ids against the project running the workflow, so one partner
// definition uses each project's own copies — no per-project duplication of the
// prompt, gates or executor settings.

// GlobalPartners lists every global partner, sorted by name.
func (r *CatalogRepo) GlobalPartners() []domain.AgentDefinition {
	out := payloadList[domain.AgentDefinition](r.DB, "global_partners", "")
	for i := range out {
		out[i] = out[i].WithDefaultEmoji()
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// GlobalPartner resolves one global partner by id.
func (r *CatalogRepo) GlobalPartner(id string) (domain.AgentDefinition, bool) {
	agent, ok := payloadOne[domain.AgentDefinition](r.DB, "global_partners", id)
	if !ok {
		return domain.AgentDefinition{}, false
	}
	// A global partner carries no project identity, whatever an older row may say.
	agent.ProjectID = ""
	agent.Shared = false
	return agent.WithDefaultEmoji(), true
}

// PutGlobalPartner creates or replaces a global partner.
func (r *CatalogRepo) PutGlobalPartner(v domain.AgentDefinition) error {
	id := strings.TrimSpace(v.ID)
	name := strings.TrimSpace(v.Name)
	if id == "" || name == "" {
		return errors.New("global partner id and name are required")
	}
	v.ID, v.Name = id, name
	// The row lives outside the project catalog, so it must not claim a project.
	v.ProjectID = ""
	v.Shared = false
	if v.Version == 0 {
		v.Version = 1
	}
	v.UpdatedAt = time.Now().UTC()
	return upsert(r.DB, "global_partners", map[string]any{
		"id":         v.ID,
		"name":       v.Name,
		"payload":    mustJSON(v),
		"updated_at": timePtr(v.UpdatedAt),
	})
}

// DeleteGlobalPartner removes a global partner.
func (r *CatalogRepo) DeleteGlobalPartner(id string) error {
	return r.DB.Exec("DELETE FROM global_partners WHERE id = ?", strings.TrimSpace(id)).Error
}
