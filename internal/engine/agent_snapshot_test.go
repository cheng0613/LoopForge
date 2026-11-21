package engine

import (
	"testing"

	"agentflow/internal/domain"
	"agentflow/internal/repo"
)

// A run freezes the partner it binds, so editing that partner mid-run does not
// change the execution already in flight. This is what makes one shared partner
// safe to edit while other projects are running it.
func TestRunFreezesPartnerAgainstLaterEdits(t *testing.T) {
	s, err := repo.OpenTest()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	if err := s.PutGlobalPartner(domain.AgentDefinition{
		ID: "shared", Name: "Original", Version: 1, ExecutorID: "codebuddy",
		Prompt: "original prompt",
	}); err != nil {
		t.Fatal(err)
	}

	wf := domain.WorkflowDefinition{
		ID: "wf", ProjectID: "any-project",
		Nodes: []domain.WorkflowNode{{ID: "n1", Name: "N1", Type: "agent", AgentID: "shared"}},
	}

	// Snapshot as run creation would.
	wf.AgentSnapshots = freezeRunAgents(s, wf)
	if len(wf.AgentSnapshots) != 1 {
		t.Fatalf("expected one frozen partner, got %d", len(wf.AgentSnapshots))
	}

	// Edit the partner afterwards, as an administrator would mid-run.
	if err := s.PutGlobalPartner(domain.AgentDefinition{
		ID: "shared", Name: "Edited", Version: 2, ExecutorID: "codebuddy",
		Prompt: "edited prompt",
	}); err != nil {
		t.Fatal(err)
	}

	frozen, ok := workflowAgent(s, wf, "shared")
	if !ok {
		t.Fatal("frozen partner did not resolve")
	}
	if frozen.Name != "Original" || frozen.Prompt != "original prompt" {
		t.Fatalf("the run picked up a later edit: %+v", frozen)
	}

	// A run created after the edit sees the new content.
	live, ok := workflowAgent(s, domain.WorkflowDefinition{ID: "wf3", ProjectID: "any-project"}, "shared")
	if !ok || live.Name != "Edited" {
		t.Fatalf("a new run should see the edit: %+v", live)
	}
}

// A run created before snapshots existed carries none, and must keep resolving
// from the live catalog rather than losing its partners.
func TestRunWithoutSnapshotFallsBackToLiveCatalog(t *testing.T) {
	s, err := repo.OpenTest()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	if err := s.PutGlobalPartner(domain.AgentDefinition{
		ID: "legacy", Name: "Legacy", Version: 1, ExecutorID: "codebuddy",
	}); err != nil {
		t.Fatal(err)
	}

	wf := domain.WorkflowDefinition{ID: "wf", ProjectID: "p"}
	if len(wf.AgentSnapshots) != 0 {
		t.Fatal("expected no snapshot on a pre-snapshot run")
	}
	agent, ok := workflowAgent(s, wf, "legacy")
	if !ok || agent.ID != "legacy" {
		t.Fatalf("a run without a snapshot must still resolve: %+v", agent)
	}
}
