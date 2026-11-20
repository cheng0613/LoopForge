package domain

import (
	"sort"
	"strings"
)

// PartnerChatPrompt renders the system brief for a conversation that belongs to
// one partner.
//
// A partner conversation is not Main Bot dispatching a subagent: the partner is
// the speaker, so its brief replaces the Main Bot identity instead of joining it
// as a dispatch target. What survives from the ordinary prompt is the platform's
// own operating rules, because those are about tooling and approval, not
// identity — dropping them would leave the partner unable to use the workbench.
//
// The returned text is empty when the partner definition carries nothing to say,
// so a conversation never gains an empty "你是「」" paragraph.
// PartnerChatBrief carries what a partner conversation needs to speak as the
// partner: the definition itself plus the rules resolved for the project.
//
// Rules are separate from the definition because they are resolved per project
// (a partner is global, the rules it names are not), the same way an SOP node
// resolves them. Passing them in keeps this function free of repository access.
type PartnerChatBrief struct {
	Partner AgentDefinition
	Rules   []RuleDefinition
}

// PartnerChatPrompt renders the system brief for a conversation that belongs to
// one partner.
func PartnerChatPrompt(partner AgentDefinition) string {
	return PartnerChatBrief{Partner: partner}.Prompt()
}

// Prompt renders the brief, or "" when there is nothing to say.
func (b PartnerChatBrief) Prompt() string {
	partner := b.Partner
	name := strings.TrimSpace(partner.Name)
	prompt := strings.TrimSpace(partner.Prompt)
	if name == "" && prompt == "" {
		return ""
	}
	if name == "" {
		name = prompt
	}
	var out strings.Builder
	out.WriteString("你是「" + name + "」")
	if description := strings.TrimSpace(partner.Description); description != "" {
		out.WriteString("，职责是：" + description)
	}
	out.WriteString("。\n")
	if prompt != "" {
		out.WriteString(prompt + "\n")
	}
	out.WriteString(b.rules(""))
	out.WriteString("本轮对话里你就是这个角色本人，直接以它的身份回答用户，不要把任务转派给其他角色，也不要说自己是 Main Bot 或助手。\n")
	return out.String()
}

// rules renders the partner's own rules highest-priority first, skipping blanks.
// Unlike a subagent's rules these are part of the speaker's identity, so they
// belong before the "you are this partner" note rather than after it.
func (b PartnerChatBrief) rules(prefix string) string {
	if len(b.Rules) == 0 {
		return ""
	}
	sorted := append([]RuleDefinition(nil), b.Rules...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Priority > sorted[j].Priority })
	var out strings.Builder
	out.WriteString(prefix + "## 该伙伴的规则\n")
	for _, rule := range sorted {
		name := strings.TrimSpace(rule.Name)
		content := strings.TrimSpace(rule.Content)
		if name == "" && content == "" {
			continue
		}
		if name != "" {
			out.WriteString("\n### " + name + "\n")
		}
		if content != "" {
			out.WriteString(content + "\n")
		}
	}
	return out.String()
}
