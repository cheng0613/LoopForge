package engine

import (
	"testing"

	"agentflow/internal/domain"
	"agentflow/internal/repo"
)

// workflowAgent is the single resolution point for every execution path, so the
// global-partner fallback is verified here rather than at each call site.
func TestWorkflowAgentResolvesGlobalPartner(t *testing.T) {
	s, err := repo.OpenTest()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	if err := s.PutGlobalPartner(domain.AgentDefinition{
		ID: "global-writer", Name: "Global writer", Version: 3, ExecutorID: "codebuddy",
	}); err != nil {
		t.Fatal(err)
	}

	// Any project resolves it, because a global partner belongs to none.
	agent, ok := workflowAgent(s, domain.WorkflowDefinition{ID: "wf", ProjectID: "any-project"}, "global-writer")
	if !ok {
		t.Fatal("global partner was not resolved from an unrelated project")
	}
	if agent.ID != "global-writer" || agent.Version != 3 || agent.ProjectID != "" {
		t.Fatalf("resolved the wrong partner: %+v", agent)
	}

	// Inside its own project a project partner still wins over the global one.
	if err := s.PutProject(domain.Project{ID: "own-project", Key: "OWN", Name: "Own"}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutAgent(domain.AgentDefinition{
		ID: "global-writer", Name: "Project writer", ProjectID: "own-project", Version: 1,
	}); err != nil {
		t.Fatal(err)
	}
	own, ok := workflowAgent(s, domain.WorkflowDefinition{ID: "wf2", ProjectID: "own-project"}, "global-writer")
	if !ok || own.Name != "Project writer" {
		t.Fatalf("the project partner should win inside its own project: %+v", own)
	}

	// An unknown id resolves to nothing rather than panicking.
	if _, ok := workflowAgent(s, domain.WorkflowDefinition{ID: "wf3", ProjectID: "own-project"}, "missing"); ok {
		t.Fatal("an unknown partner should not resolve")
	}
}
