package engine

import (
	"testing"

	"agentflow/internal/domain"
	"agentflow/internal/repo"
)

// One global partner serves several projects at once. The assets it references
// (rules, skills) resolve against the project running it, so a project only ever
// sees its own copies — it never borrows another project's.
//
// A skill id is globally unique (skills.id is the primary key), so the same
// concept in two projects carries a per-project id, exactly as the shipped
// catalog does ("loopforge-design-admin-project"). The partner therefore lists
// one id per project, and each project keeps only its own.
func TestOneGlobalPartnerServesSeveralProjectsWithTheirOwnAssets(t *testing.T) {
	s, err := repo.OpenTest()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	projects := []string{"alpha", "beta"}
	for _, p := range projects {
		if err := s.PutProject(domain.Project{ID: p, Key: p[:1], Name: p}); err != nil {
			t.Fatal(err)
		}
		if err := s.PutSkill(domain.SkillDefinition{
			ID: "code-style-" + p, Name: "Code style " + p, ProjectID: p,
			Content: "style for " + p,
		}); err != nil {
			t.Fatal(err)
		}
		if err := s.PutRule(domain.RuleDefinition{
			ID: "core-rule-" + p, Name: "Core " + p, ProjectID: p,
			Content: "rule for " + p,
		}); err != nil {
			t.Fatal(err)
		}
	}

	// One partner, owned by nobody, listing both projects' asset ids.
	if err := s.PutGlobalPartner(domain.AgentDefinition{
		ID: "shared-reviewer", Name: "共用评审员", Version: 1, ExecutorID: "codebuddy",
		Skills: []string{"code-style-alpha", "code-style-beta"},
		Rules:  []string{"core-rule-alpha", "core-rule-beta"},
	}); err != nil {
		t.Fatal(err)
	}

	e := New(s, nil)
	for _, project := range projects {
		agent, ok := workflowAgent(s, domain.WorkflowDefinition{ID: "wf-" + project, ProjectID: project}, "shared-reviewer")
		if !ok {
			t.Fatalf("project %s could not resolve the global partner", project)
		}
		bundle := e.resolveAssets(agent, project, "wf-"+project, 1)

		if len(bundle.Skills) != 1 || bundle.Skills[0].ID != "code-style-"+project {
			t.Fatalf("project %s got the wrong skills: %+v", project, bundle.Skills)
		}
		if len(bundle.Rules) != 1 || bundle.Rules[0].ID != "core-rule-"+project {
			t.Fatalf("project %s got the wrong rules: %+v", project, bundle.Rules)
		}
	}
}
