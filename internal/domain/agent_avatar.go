package domain

import (
	"hash/fnv"
	"strings"
)

// partnerAvatars is the pool a role without an explicit emoji draws from.
//
// Animals on purpose: a role is a teammate, and an animal reads as a character
// where a letter avatar reads as an abbreviation. The pool is deliberately larger
// than any one project's role list so neighbours rarely collide.
var partnerAvatars = []string{
	"🦊", "🦉", "🐱", "🦔", "🦝", "🐰", "🐼", "🐨",
	"🐯", "🦁", "🐸", "🐙", "🦈", "🐧", "🦩", "🐢",
}

// DefaultAgentEmoji picks an avatar from the role id.
//
// Deriving from the id rather than the position keeps the picture stable when
// roles are added, renamed or reordered: the same role always gets the same face,
// and nobody else's changes. Hashing means two roles can collide, which is
// visible but harmless — a user who minds can set one explicitly.
func DefaultAgentEmoji(id string) string {
	trimmed := strings.TrimSpace(id)
	if trimmed == "" {
		return partnerAvatars[0]
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(trimmed))
	return partnerAvatars[int(h.Sum32()%uint32(len(partnerAvatars)))]
}

// DisplayEmoji returns the stored avatar, or the deterministic default.
//
// Callers render this rather than Emoji directly so a role saved before avatars
// existed still displays one, without a migration or a backfill write.
func (a AgentDefinition) DisplayEmoji() string {
	if emoji := strings.TrimSpace(a.Emoji); emoji != "" {
		return emoji
	}
	return DefaultAgentEmoji(a.ID)
}

// WithDefaultEmoji returns a copy whose Emoji is resolved.
//
// Used on the read path: the stored payload stays as written, so an operator can
// still tell "chose this" from "got the default", and a future avatar list can be
// changed without rewriting every row.
func (a AgentDefinition) WithDefaultEmoji() AgentDefinition {
	a.Emoji = a.DisplayEmoji()
	return a
}

// PartnerAvatars returns a copy of the pool, for pickers in the UI.
func PartnerAvatars() []string {
	return append([]string(nil), partnerAvatars...)
}
