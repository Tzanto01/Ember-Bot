# 🔥 Ember — Discord Habit Tracker Bot

## 📌 Overview
A low-pressure, neurodivergent-friendly Discord habit tracker bot. Built for people who struggle with habit consistency not because they don't care, but because of how their brain works (ADHD, autism, etc.).

**Core philosophy:** No punishment, no guilt. Progress over perfection.

---

## 🎯 Target User
Neurodivergent people (ADHD, autism) who struggle with habit consistency.

---

## 🤖 How it works
- Works in both **DMs** (private, personal use) and **Servers** (group accountability)
- Server features are **opt-in** — private by default
- Reminders sent via DM with a single ✅ / ❌ button — minimal friction

---

## 📦 MVP Feature Set

### Must-Have (v1)
- `/habit add` — create a habit with an optional daily reminder time
- `/habit checkin` — log today's habit (one button click)
- `/habit list` — see your habits + current streaks
- `/habit streak` — see your personal stats
- Scheduled DM reminders with a single ✅ / ❌ button
- **Flexible streak system** — "X out of last 7 days", not just consecutive days

### Cut From MVP (add later)
- Leaderboards
- Group accountability
- Natural language input
- Habit categories/tags
- Weekly summaries

---

## 🔧 Tech Stack
| Layer | Choice | Reason |
|---|---|---|
| **Language** | C# | Primary language |
| **Discord library** | Discord.Net | Already familiar |
| **Scheduler** | Quartz.NET | Reliable, well-documented |
| **Database** | PostgreSQL | Via Npgsql EF Core provider |
| **Hosting** | Railway (free tier) | Easiest for a bot |

---

## 🗃️ Data Model

```
User
- DiscordUserId
- Timezone

Habit
- Id
- UserId
- Name
- ReminderTime (nullable)
- CreatedAt

HabitLog
- Id
- HabitId
- Date
- Completed (bool)
```

---

## 🗺️ Roadmap
| Phase | Goal | Timeframe |
|---|---|---|
| **1** | Basic slash commands + SQLite | Week 1 |
| **2** | Scheduled DM reminders | Week 2 |
| **3** | Flexible streak logic + button check-ins | Week 3 |
| **4** | Polish messaging tone (no guilt language) | Week 4 |
| **5** | Deploy to Railway, invite to test servers | Week 5+ |

---

## 💡 Key Design Decisions
- **No guilt mechanics** — missed streaks are not punished harshly
- **Flexible streaks** — "3 out of 5 days" counts as a win
- **Minimal friction** — one button click max for check-ins
- **Gentle re-engagement** — soft language when users miss days
- **Privacy by default** — server features are opt-in only
- **DM + Server support** — DMs for private use, servers for group accountability