package repo

import (
	"testing"
	"time"

	"agentflow/internal/domain"
)

// A send must not unbind a partner conversation.
//
// The client sends its own copy of the conversation with every turn, and that copy
// was built before the partner was chosen (or never carried it at all), so
// accepting it verbatim cleared the binding. The visible symptom was subtle: the
// first reply was in character, then the next turn answered as LoopForge again.
func TestBeginAssistantGenerationKeepsThePartnerBinding(t *testing.T) {
	s := cvEStore(t)
	bound := domain.AssistantSession{
		ID: "partner-session", UserID: 10, Title: "和伙伴聊", PartnerID: "role-5r10",
		UpdatedAt: time.Now().UTC(),
	}
	if err := s.PutAssistantSession(10, bound); err != nil {
		t.Fatalf("seed session: %v", err)
	}

	// The client's copy has no partner, exactly as a browser sends it.
	fromClient := bound
	fromClient.PartnerID = ""
	fromClient.Messages = append(fromClient.Messages, domain.AssistantMessage{Role: "user", Content: "你是谁"})

	g := domain.AssistantGeneration{
		ID: "g-partner", SessionID: bound.ID, UserID: 10, Status: "running", StartedAt: time.Now().UTC(),
	}
	if err := s.BeginAssistantGeneration(g, fromClient); err != nil {
		t.Fatalf("begin generation: %v", err)
	}

	got, ok := s.AssistantSession(10, bound.ID)
	if !ok {
		t.Fatal("session disappeared")
	}
	if got.PartnerID != "role-5r10" {
		t.Errorf("partner binding was cleared by a send: got %q, want role-5r10", got.PartnerID)
	}
	// The turn itself must still be recorded.
	if len(got.Messages) != 1 {
		t.Errorf("the user's message was lost: %d messages", len(got.Messages))
	}
}

// An ordinary conversation must not acquire a partner from the client either: the
// binding is set once, when the conversation is created.
func TestBeginAssistantGenerationDoesNotInventAPartner(t *testing.T) {
	s := cvEStore(t)
	plain := domain.AssistantSession{
		ID: "plain-session", UserID: 10, Title: "普通对话", UpdatedAt: time.Now().UTC(),
	}
	if err := s.PutAssistantSession(10, plain); err != nil {
		t.Fatalf("seed session: %v", err)
	}

	g := domain.AssistantGeneration{
		ID: "g-plain", SessionID: plain.ID, UserID: 10, Status: "running", StartedAt: time.Now().UTC(),
	}
	if err := s.BeginAssistantGeneration(g, plain); err != nil {
		t.Fatalf("begin generation: %v", err)
	}

	got, ok := s.AssistantSession(10, plain.ID)
	if !ok {
		t.Fatal("session disappeared")
	}
	if got.PartnerID != "" {
		t.Errorf("an ordinary conversation gained a partner: %q", got.PartnerID)
	}
}
