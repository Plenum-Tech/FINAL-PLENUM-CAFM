# 🤖 CLAUDE.md – AI Chat Interface (Smart Assistant UI)

## 🎯 Objective

Build a **smart AI chatbot interface** that:

* Understands user queries about data migration
* Provides contextual, step-aware answers
* Integrates with pipeline (mapping, errors, logs)
* Supports real-time streaming responses

---

# 🧠 1. Chat Experience Design (NOT Basic Chat)

## ❌ Avoid:

* Simple input + output chat

## ✅ Build:

* Context-aware assistant
* Step-aware intelligence
* Actionable responses

---

# 🧱 2. Core UI Components

## 2.1 Chat Layout

### Sections:

* Header (Migration ID + Status)
* Chat messages area
* Input box (multi-line)
* Right panel (context info)

---

## 2.2 Message Types

### 1. User Message

* Plain text

### 2. AI Message

* Rich response:

  * formatted text
  * code blocks
  * tables

### 3. System Message

* pipeline updates
* alerts (e.g. "Mapping paused for approval")

---

## 2.3 Smart Suggestions (IMPORTANT)

Auto-suggest buttons:

Examples:

* “Show unmapped fields”
* “Why was this field rejected?”
* “Fix mapping for asset_name”
* “Show errors”

👉 These reduce typing and improve UX

---

## 2.4 Context Panel (Right Side)

Shows:

* Current step (e.g. Semantic Mapping)
* Stats:

  * mapped fields
  * unresolved fields
* Selected entity (if user clicks)

---

# 🔌 3. Backend Integration

## 3.1 Chat API

POST `/api/chat`

Payload:

```json id="p6xq7l"
{
  "message": "Why is asset_name not mapped?",
  "migration_id": "123"
}
```

---

## 3.2 Streaming Response

Use:

* WebSocket OR
* Server-Sent Events (SSE)

👉 Token streaming (like ChatGPT)

---

## 3.3 Context Injection (VERY IMPORTANT)

Send with every request:

```json id="xkz4bi"
{
  "current_step": "mapping",
  "unresolved_fields": [...],
  "recent_logs": [...]
}
```

👉 This makes AI “smart”

---

# ⚙️ 4. State Management

```js id="r5z6bi"
{
  messages: [],
  loading: false,
  streaming: true,
  context: {
    currentStep: "",
    stats: {},
    selectedField: null
  }
}
```

---

# 🔥 5. Smart Features (Differentiator)

## 5.1 Context-Aware Answers

User:
👉 “Why this failed?”

AI:
👉 Understand current step + logs → answer correctly

---

## 5.2 Actionable Responses

AI should return actions:

```json id="9h12jd"
{
  "answer": "Asset name not mapped due to low confidence",
  "actions": [
    { "type": "highlight_field", "field": "Machine Name" },
    { "type": "open_mapping_ui" }
  ]
}
```

---

## 5.3 Inline Fix UI

AI response me:

* “Fix mapping” button
* click → open mapping modal

---

## 5.4 Step Awareness

AI knows:

* current pipeline stage
* what user should do next

---

## 🎨 6. UI/UX Guidelines

## Design Style:

* ChatGPT / Claude inspired
* Clean + minimal
* Dark mode

## UX Rules:

* Fast response (<1s feel with streaming)
* No clutter
* Clear hierarchy

---

# 🧪 7. Edge Cases

* Empty response
* API timeout
* Streaming break → resume
* hallucinated answer → show disclaimer

---

# 📊 8. Advanced Features (Optional but Powerful)

## 8.1 Chat + Data Linking

* Click field → ask question directly

## 8.2 History Memory

* maintain session context

## 8.3 Multi-turn understanding

* follow-up questions supported

---

# 🔐 9. Security

* sanitize user input
* limit prompt size
* avoid exposing raw DB

---

# 🚀 10. Tech Stack

* React + TypeScript
* Tailwind CSS
* WebSocket / SSE
* Zustand / Redux
* Markdown renderer (for AI responses)

---

# 🧩 11. Component Structure

```id="j2k9sl"
components/
  Chat/
    ChatContainer.tsx
    MessageList.tsx
    MessageItem.tsx
    ChatInput.tsx
    Suggestions.tsx
  ContextPanel/
    StepInfo.tsx
    StatsCard.tsx
```

---

# ✅ 12. Deliverables Checklist

* [ ] Chat UI (Claude-style)
* [ ] Streaming responses
* [ ] Context-aware API integration
* [ ] Smart suggestions
* [ ] Actionable responses
* [ ] Error handling
* [ ] Context panel

---

# 🔥 One Line Summary

AI Chat should act as a **smart assistant + control layer**, not just a chatbot.
