// status.ts — availability status profiles for office use.
//
// Each profile maps a human-friendly label to the face expression, pet mood,
// and optional scrolling text that best communicates your current state.
// When `text` is set, the text view is shown (readable at a glance by
// colleagues); otherwise the face expression is shown.

export interface StatusProfile {
  name: string;        // CLI slug used in the protocol (e.g. "in-meeting")
  label: string;       // Human-readable label shown in the picker
  description: string; // Short description / tooltip
  face: string;        // Expression name (matches firmware ExpressionId names)
  mood: string;        // Mood name (matches firmware Mood names)
  text?: string;       // Scrolling text to display (overrides face view when set)
}

export const STATUS_PROFILES: StatusProfile[] = [
  {
    name: "available",
    label: "Available",
    description: "Free to chat and collaborate",
    face: "happy",
    mood: "content",
  },
  {
    name: "busy",
    label: "Busy",
    description: "Working — keep interruptions to a minimum",
    face: "neutral",
    mood: "grumpy",
  },
  {
    name: "in-meeting",
    label: "In Meeting",
    description: "Currently in a meeting",
    face: "neutral",
    mood: "content",
    text: "In Meeting",
  },
  {
    name: "deep-focus",
    label: "Deep Focus",
    description: "Flow state — please don't interrupt",
    face: "sleepy",
    mood: "sleepy",
    text: "Deep Focus",
  },
  {
    name: "frustrated",
    label: "Frustrated",
    description: "Hitting blockers or feeling stressed",
    face: "angry",
    mood: "grumpy",
  },
  {
    name: "on-break",
    label: "On Break",
    description: "Coffee or lunch — back soon",
    face: "excited",
    mood: "playful",
    text: "On Break!",
  },
  {
    name: "away",
    label: "Away",
    description: "Stepped away from my desk",
    face: "sleepy",
    mood: "sleepy",
    text: "Away",
  },
  {
    name: "do-not-disturb",
    label: "Do Not Disturb",
    description: "Absolute focus — hold all messages",
    face: "dead",
    mood: "grumpy",
    text: "DND",
  },
  {
    name: "reviewing",
    label: "Reviewing",
    description: "In a code or document review",
    face: "surprised",
    mood: "content",
    text: "Reviewing",
  },
  {
    name: "thinking",
    label: "Thinking",
    description: "Problem-solving mode — give me a moment",
    face: "surprised",
    mood: "playful",
  },
];

// Case-insensitive lookup by slug name.
export function findStatus(name: string): StatusProfile | undefined {
  return STATUS_PROFILES.find((p) => p.name.toLowerCase() === name.toLowerCase());
}
