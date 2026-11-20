package httpapi

import (
	"agentflow/internal/domain"

	"agentflow/internal/repo"
	"bytes"

	"encoding/json"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
)

// Storage retains a stable slot; authorization and tool credentials always use
// the caller, never the user who first opened a run conversation.
func assistantStorageOwner(st *repo.Store, id string, fallback int64) int64 {
	if s, ok := st.SharedAssistantSession(id); ok {
		return s.UserID
	}
	if s, ok := st.ProjectAssistantSession(id); ok {
		return s.UserID
	}
	return fallback
}

// conversationScope returns the storage owner and whether the conversation is
// multi-user. SOP run sessions and every conversation bound to a project are
// shared with that project's members; only unbound conversations are private.
func (h *assistantHandlers) conversationScope(c *gin.Context, id, runID, projectID string, userID int64) (int64, bool, error) {
	if s, ok := h.repo.SharedAssistantSession(id); ok {
		r, exists := h.repo.RunState(s.RunID)
		if s.ProjectID == "" || !exists || r.ExecutionContext.ProjectID != s.ProjectID || !h.workbenchProjectAllowed(c, s.ProjectID, userID) {
			return 0, false, fmt.Errorf("无权访问共享 SOP 会话")
		}
		if (runID != "" && runID != s.RunID) || (projectID != "" && projectID != s.ProjectID) {
			return 0, false, fmt.Errorf("会话与 SOP 运行不匹配")
		}
		return s.UserID, true, nil
	}
	if runID != "" {
		return 0, false, fmt.Errorf("请从任务运行打开共享 SOP 会话")
	}
	if s, ok := h.repo.ProjectAssistantSession(id); ok {
		if !h.workbenchProjectAllowed(c, s.ProjectID, userID) {
			return 0, false, errProjectConversationReadOnly
		}
		return s.UserID, true, nil
	}
	return userID, false, nil
}

var errProjectConversationReadOnly = fmt.Errorf("你不是该项目的成员，只能查看这个会话；加入项目后才能继续聊")

// conversationReadScope extends conversationScope for viewing: any signed-in
// user may read an ordinary project conversation by link. Writing, continuing,
// branching and attachments outside the transcript still use conversationScope.
func (h *assistantHandlers) conversationReadScope(c *gin.Context, id string, userID int64) (owner int64, shared, readOnly bool, err error) {
	owner, shared, err = h.conversationScope(c, id, "", "", userID)
	if err == nil {
		return owner, shared, false, nil
	}
	if s, ok := h.repo.ProjectAssistantSession(id); ok {
		return s.UserID, true, true, nil
	}
	return 0, false, false, err
}
func (h *assistantHandlers) runConversation(c *gin.Context) {
	user, ok := h.requestUser(c.Request, true)
	if !ok {
		c.JSON(401, gin.H{"error": "请先登录"})
		return
	}
	r, ok := h.repo.RunState(c.Param("id"))
	if !ok {
		c.JSON(404, gin.H{"error": "运行不存在"})
		return
	}
	project := r.ExecutionContext.ProjectID
	if project == "" {
		c.JSON(403, gin.H{"error": "运行未绑定项目，不能创建共享会话"})
		return
	}
	if !h.workbenchProjectAllowed(c, project, user.ID) {
		c.JSON(403, gin.H{"error": "无权访问项目"})
		return
	}
	title := r.WorkflowSnapshot.Name
	if title == "" {
		title = r.WorkflowID
	}
	target := domain.AssistantExecutionTarget{Pool: r.ExecutionContext.ExecutionMode, RunnerID: r.ExecutionContext.ExecutionRunnerID}
	if target.Pool != domain.ExecutionModeRunner {
		target.Pool = domain.ExecutionModeCloud
	}
	session, err := h.repo.EnsureRunAssistantSession(r.ID, project, title, user.ID, target)
	if err != nil {
		c.JSON(500, gin.H{"error": "读取共享会话失败"})
		return
	}
	c.Header("Cache-Control", "no-store")
	session.IssueID = r.ExecutionContext.IssueID
	c.JSON(200, session)
}
func sharedTranscriptPrefix(old []assistantMessage, next []assistantMessage) bool {
	if len(next) < len(old) {
		return false
	}
	for i, m := range old {
		a, _ := json.Marshal(m)
		b, _ := json.Marshal(next[i])
		if !bytes.Equal(a, b) {
			return false
		}
	}
	return true
}
func assistantRequestApprovalMode(req assistantRequest) string {
	return normalizeAssistantApprovalMode(req.ApprovalMode)
}

func assistantSystemPromptForRequest(req assistantRequest, mode string) string {
	base := assistantSystemPromptForMode(mode)
	// A partner conversation speaks as that partner. The identity sentence is
	// swapped in the system prompt itself: the platform prompt opens with
	// "你是 LoopForge 的统一协作助手", and an identity stated later in the user
	// turn loses to it. Everything after the identity paragraph — tooling,
	// approval and write-protocol rules — still applies, because those are about
	// how to use the platform, not who is speaking.
	if partner := strings.TrimSpace(req.partnerPrompt); partner != "" {
		base = partnerSystemPrompt(base, partner)
	}
	return withSpaceDeliverable(req, base)
}

// partnerSystemPrompt drops the platform's own identity sentence and leads with
// the partner's brief instead.
//
// Two prompts carry an identity sentence: the assistant one and the workspace one.
// Whichever is in play, the first line naming LoopForge is removed. Matching on
// the sentence rather than the position keeps this working if the constants are
// reworded; when no marker is found the brief is still prepended, which beats
// silently not applying it.
func partnerSystemPrompt(base, partner string) string {
	for _, identity := range []string{
		"你是 LoopForge 的统一协作助手。",
		"你是 LoopForge 工作区助手。",
	} {
		if i := strings.Index(base, identity); i >= 0 {
			if end := strings.Index(base[i:], "\n"); end >= 0 {
				base = base[:i] + base[i+end+1:]
			} else {
				base = base[:i] + base[i+len(identity):]
			}
			break
		}
	}
	return partner + "\n" + base
}

// Only approval receipts may update a shared transcript. Existing messages and
// attribution are immutable; the optimistic timestamp prevents stale overwrites.
func sharedReceiptUpdate(old, next domain.AssistantSession, userID int64, name string) error {
	if !next.UpdatedAt.Equal(old.UpdatedAt) {
		return fmt.Errorf("共享会话已更新，请重新打开")
	}
	if len(next.Messages) < len(old.Messages) {
		return fmt.Errorf("不能删除共享会话消息")
	}
	for i, m := range old.Messages {
		n := next.Messages[i]
		if m.Role == "assistant" && n.Content != m.Content {
			var a, b map[string]any
			if json.Unmarshal([]byte(m.Content), &a) != nil || json.Unmarshal([]byte(n.Content), &b) != nil {
				return fmt.Errorf("不能改写共享会话回复")
			}
			scrub := func(v map[string]any) {
				ds, _ := v["drafts"].([]any)
				for _, d := range ds {
					if x, ok := d.(map[string]any); ok {
						delete(x, "saved")
						delete(x, "savedId")
						delete(x, "savedResult")
					}
				}
			}
			scrub(a)
			scrub(b)
			aa, _ := json.Marshal(a)
			bb, _ := json.Marshal(b)
			if !bytes.Equal(aa, bb) {
				return fmt.Errorf("只能记录草稿执行回执")
			}
			n.Content = m.Content
		}
		aa, _ := json.Marshal(m)
		bb, _ := json.Marshal(n)
		if !bytes.Equal(aa, bb) {
			return fmt.Errorf("不能改写共享会话消息")
		}
	}
	for i := len(old.Messages); i < len(next.Messages); i++ {
		m := &next.Messages[i]
		if m.Role != "user" {
			return fmt.Errorf("只能追加用户回执")
		}
		if !bytes.HasPrefix([]byte(m.Content), []byte("已通过 MCP 执行 ")) {
			return fmt.Errorf("请通过发送接口追加讨论")
		}
		m.AuthorID = userID
		m.AuthorName = name
		m.SpeakerName = ""
		m.SpeakerAgentID = ""
		m.Model = ""
		m.Usage = nil
	}
	return nil
}

// Messages carrying a system trigger (retired role follow-ups) may only be
// resent unchanged at their stored position; new turns cannot carry one.
func (h *assistantHandlers) validateAssistantTriggerHistory(ownerID int64, req assistantRequest) error {
	old, _ := h.repo.AssistantSession(ownerID, req.SessionID)
	for i, message := range req.Messages {
		if message.Trigger == "" && message.TriggerID == "" {
			continue
		}
		if i >= len(old.Messages) {
			return fmt.Errorf("不能伪造系统触发标记")
		}
		a, _ := json.Marshal(message)
		b, _ := json.Marshal(old.Messages[i])
		if string(a) != string(b) {
			return fmt.Errorf("不能改写系统触发标记")
		}
	}
	return nil
}
