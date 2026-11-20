package domain

import (
	"strings"
	"testing"
)

// A partner conversation speaks as the partner. The brief has to name it and
// carry its prompt, or the model falls back to Main Bot and the conversation is
// only cosmetically "the partner's".
func TestPartnerChatPromptNamesThePartnerAndCarriesItsPrompt(t *testing.T) {
	partner := AgentDefinition{
		ID:          "role-5r10",
		Name:        "研发工程师",
		Description: "根据任务书完成代码变更",
		Prompt:      "先读规则，再实施最小改动。",
	}
	got := PartnerChatPrompt(partner)
	if !strings.Contains(got, "研发工程师") {
		t.Errorf("prompt does not name the partner:\n%s", got)
	}
	if !strings.Contains(got, "先读规则，再实施最小改动。") {
		t.Errorf("prompt drops the partner's own brief:\n%s", got)
	}
	if !strings.Contains(got, "根据任务书完成代码变更") {
		t.Errorf("prompt drops the description:\n%s", got)
	}
	// The whole point of the binding: it must not invite Main Bot behaviour.
	if !strings.Contains(got, "不要把任务转派给其他角色") {
		t.Errorf("prompt does not forbid dispatching itself:\n%s", got)
	}
}

// A partner with no prompt still needs an identity line; otherwise the
// replacement is an empty string and Main Bot speaks.
func TestPartnerChatPromptStillIdentifiesANamelessPrompt(t *testing.T) {
	got := PartnerChatPrompt(AgentDefinition{ID: "role-x", Name: "测试执行"})
	if !strings.Contains(got, "测试执行") {
		t.Errorf("prompt lost the partner name:\n%s", got)
	}
}

// Trimmmed/blank fields must not produce "你是「」" or a dangling comma.
func TestPartnerChatPromptHandlesBlankFields(t *testing.T) {
	got := PartnerChatPrompt(AgentDefinition{ID: "role-x", Name: "  ", Prompt: "  ", Description: "  "})
	if strings.TrimSpace(got) != "" {
		t.Errorf("an empty partner should yield no prompt, got:\n%s", got)
	}
	if strings.Contains(got, "「」") || strings.Contains(got, "，职责是：。") {
		t.Errorf("blank fields leaked into the prompt:\n%s", got)
	}
}

// The partner's rules are part of who it is, so they must reach the prompt, and
// the highest priority must come first as an SOP node does.
func TestPartnerChatPromptCarriesRulesHighestPriorityFirst(t *testing.T) {
	got := PartnerChatBrief{
		Partner: AgentDefinition{ID: "role-x", Name: "代码评审", Prompt: "只提可执行意见。"},
		Rules: []RuleDefinition{
			{ID: "r-low", Name: "低优先", Content: "低优先内容", Priority: 1},
			{ID: "r-high", Name: "高优先", Content: "高优先内容", Priority: 9},
			{ID: "r-blank", Name: "  ", Content: "  "},
		},
	}.Prompt()
	high := strings.Index(got, "高优先内容")
	low := strings.Index(got, "低优先内容")
	if high < 0 || low < 0 {
		t.Fatalf("rules missing from the prompt:\n%s", got)
	}
	if high > low {
		t.Errorf("rules are out of priority order:\n%s", got)
	}
	if strings.Contains(got, "###  \n") {
		t.Errorf("a blank rule name leaked into the prompt:\n%s", got)
	}
}

// A partner with no rules must not gain an empty rules heading.
func TestPartnerChatPromptOmitsRulesHeadingWhenThereAreNone(t *testing.T) {
	got := PartnerChatPrompt(AgentDefinition{ID: "role-x", Name: "需求分析", Prompt: "拆解任务。"})
	if strings.Contains(got, "## 该伙伴的规则") {
		t.Errorf("empty rules heading rendered:\n%s", got)
	}
}

// The description is optional; without one the sentence must still read.
func TestPartnerChatPromptOmitsMissingDescription(t *testing.T) {
	got := PartnerChatPrompt(AgentDefinition{ID: "role-x", Name: "方案设计", Prompt: "产出设计文档。"})
	if strings.Contains(got, "职责是：") {
		t.Errorf("a missing description should not leave an empty clause:\n%s", got)
	}
	if !strings.Contains(got, "方案设计") || !strings.Contains(got, "产出设计文档。") {
		t.Errorf("prompt incomplete:\n%s", got)
	}
}
