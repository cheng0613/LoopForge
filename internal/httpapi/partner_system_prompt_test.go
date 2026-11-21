package httpapi

import (
	"strings"
	"testing"
)

// The platform prompt opens by declaring itself the assistant. A partner
// conversation must not keep that sentence, or the model keeps answering as
// LoopForge — which is exactly the bug this covers.
func TestPartnerSystemPromptReplacesAssistantIdentity(t *testing.T) {
	base := "你是 LoopForge 的统一协作助手。普通会话帮助用户查询。\n第二条规则。"
	got := partnerSystemPrompt(base, "你是「研发工程师」，职责是：完成代码变更。")
	if strings.Contains(got, "你是 LoopForge 的统一协作助手") {
		t.Errorf("the assistant identity survived:\n%s", got)
	}
	if !strings.HasPrefix(got, "你是「研发工程师」") {
		t.Errorf("the partner brief is not first:\n%s", got)
	}
	// The rules that follow must survive: they govern tool use, not identity.
	if !strings.Contains(got, "第二条规则。") {
		t.Errorf("the rest of the prompt was dropped:\n%s", got)
	}
}

// The workspace prompt has its own identity line; a handoff must not revert to
// speaking as LoopForge's workspace assistant.
func TestPartnerSystemPromptReplacesWorkspaceIdentity(t *testing.T) {
	base := "你是 LoopForge 工作区助手。你正在工作区内运行。\n工作区规则。"
	got := partnerSystemPrompt(base, "你是「代码评审」。")
	if strings.Contains(got, "你是 LoopForge 工作区助手") {
		t.Errorf("the workspace identity survived:\n%s", got)
	}
	if !strings.Contains(got, "工作区规则。") {
		t.Errorf("workspace rules were dropped:\n%s", got)
	}
	if !strings.HasPrefix(got, "你是「代码评审」。") {
		t.Errorf("the partner brief is not first:\n%s", got)
	}
}

// A prompt with no known identity line must still gain the brief; silently
// keeping Main Bot is the failure mode that matters.
func TestPartnerSystemPromptPrependsWhenNoMarkerFound(t *testing.T) {
	got := partnerSystemPrompt("没有任何身份句的提示词。", "你是「需求分析」。")
	if !strings.HasPrefix(got, "你是「需求分析」。") {
		t.Errorf("the brief was not prepended:\n%s", got)
	}
	if !strings.Contains(got, "没有任何身份句的提示词。") {
		t.Errorf("the original prompt was lost:\n%s", got)
	}
}

// An identity line that is the whole prompt (no trailing newline) must be
// removed without panicking or leaving a fragment.
func TestPartnerSystemPromptHandlesIdentityOnlyPrompt(t *testing.T) {
	got := partnerSystemPrompt("你是 LoopForge 的统一协作助手。", "你是「测试执行」。")
	if strings.Contains(got, "LoopForge") {
		t.Errorf("identity survived:\n%s", got)
	}
	if !strings.HasPrefix(got, "你是「测试执行」。") {
		t.Errorf("brief missing:\n%s", got)
	}
}

// The shared entry point only rewrites when a partner is bound; an ordinary
// conversation must be byte-identical to before.
func TestSystemPromptForRequestLeavesOrdinaryConversationsAlone(t *testing.T) {
	want := withSpaceDeliverable(assistantRequest{}, assistantSystemPromptForMode(AssistantApprovalConfirm))
	got := assistantSystemPromptForRequest(assistantRequest{}, AssistantApprovalConfirm)
	if got != want {
		t.Error("an unbound conversation's prompt changed")
	}
}

// And when a partner is bound, the identity is replaced at the shared entry
// point, so every caller (chat, generations, steer) gets it.
func TestSystemPromptForRequestAppliesPartnerBrief(t *testing.T) {
	req := assistantRequest{partnerPrompt: "你是「方案设计」，职责是产出设计文档。"}
	got := assistantSystemPromptForRequest(req, AssistantApprovalConfirm)
	if !strings.HasPrefix(got, "你是「方案设计」") {
		t.Errorf("partner brief not applied:\n%.120s", got)
	}
	if strings.Contains(got, "你是 LoopForge 的统一协作助手") {
		t.Errorf("assistant identity survived:\n%.120s", got)
	}
}
