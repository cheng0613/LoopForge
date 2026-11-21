package domain

import "testing"

// The same role must always get the same face, or every list render would shuffle
// the avatars and users would lose the association they had learned.
func TestDefaultAgentEmojiIsStable(t *testing.T) {
	first := DefaultAgentEmoji("role-5r10")
	for i := 0; i < 20; i++ {
		if got := DefaultAgentEmoji("role-5r10"); got != first {
			t.Fatalf("default emoji changed between calls: %q then %q", first, got)
		}
	}
}

// Renaming or reordering roles must not move anyone else's avatar, which is why the
// default derives from the id rather than from the position in a list.
func TestDefaultAgentEmojiIgnoresEverythingButID(t *testing.T) {
	id := "role-5r10"
	want := DefaultAgentEmoji(id)

	renamed := AgentDefinition{ID: id, Name: "完全不同的名字", Version: 99}
	if got := renamed.DisplayEmoji(); got != want {
		t.Errorf("display emoji = %q, want %q", got, want)
	}
}

func TestDisplayEmojiPrefersTheStoredValue(t *testing.T) {
	agent := AgentDefinition{ID: "role-5r10", Emoji: "🐙"}
	if got := agent.DisplayEmoji(); got != "🐙" {
		t.Errorf("display emoji = %q, want the stored one", got)
	}
	// Whitespace is not a choice.
	blank := AgentDefinition{ID: "role-5r10", Emoji: "   "}
	if got := blank.DisplayEmoji(); got != DefaultAgentEmoji("role-5r10") {
		t.Errorf("a blank emoji should fall back to the default, got %q", got)
	}
}

// Reading must not invent a stored value: an operator needs to be able to tell a
// chosen avatar from a default one.
func TestWithDefaultEmojiDoesNotMutateTheInput(t *testing.T) {
	original := AgentDefinition{ID: "role-5r10"}
	resolved := original.WithDefaultEmoji()
	if resolved.Emoji == "" {
		t.Fatal("resolved copy should carry an emoji")
	}
	if original.Emoji != "" {
		t.Errorf("the original was mutated: %q", original.Emoji)
	}
}

// An empty id must not panic or return an empty avatar; rows can be malformed.
func TestDefaultAgentEmojiHandlesEmptyID(t *testing.T) {
	for _, id := range []string{"", "   "} {
		if got := DefaultAgentEmoji(id); got == "" {
			t.Errorf("id %q produced an empty emoji", id)
		}
	}
}

// The pool should spread roles out rather than collapsing everything onto one
// animal, and every entry must be non-empty.
func TestDefaultAgentEmojiSpreadsAcrossThePool(t *testing.T) {
	seen := map[string]bool{}
	for _, id := range []string{
		"role-a", "role-b", "role-c", "role-d", "role-e", "role-f",
		"role-g", "role-h", "role-i", "role-j", "role-k", "role-l",
	} {
		emoji := DefaultAgentEmoji(id)
		if emoji == "" {
			t.Fatalf("id %q produced an empty emoji", id)
		}
		seen[emoji] = true
	}
	if len(seen) < 4 {
		t.Errorf("12 ids produced only %d distinct avatars: %v", len(seen), seen)
	}
}

// The picker needs the pool, and must not be able to corrupt the package slice.
func TestPartnerAvatarsReturnsACopy(t *testing.T) {
	pool := PartnerAvatars()
	if len(pool) == 0 {
		t.Fatal("the pool is empty")
	}
	pool[0] = "changed"
	if PartnerAvatars()[0] == "changed" {
		t.Error("PartnerAvatars handed out the internal slice")
	}
	for _, emoji := range PartnerAvatars() {
		if emoji == "" {
			t.Error("the pool contains an empty entry")
		}
	}
}
