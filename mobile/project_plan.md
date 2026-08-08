# eeclass Class Notes — Mobile App

## 1. Project description
A smart note-taking mobile app for university classrooms. The phone turns on the mic to capture audio and streams it to a recognition service running on the user's own computer/server, producing real-time captions, AI organization, and post-class review. **All speech recognition, speaker separation, voiceprint, and AI happen locally on the backend; the phone is just a client, and audio is never sent to any third party.**

**Target users**: Chinese university students and teachers
**Core value**: real-time phone recording and transcription → automatic AI summary → flashcard / self-test / follow-up review → class whiteboard screenshots aligned to the timeline → full-text search across courses

## 2. Page structure (mobile)
- `/` — Home (console: statistics, search shortcut, schedule calendar)
- `/record` — Recording page (ready / recording / ended)
- `/courses` — Courses page (past sessions, grouped by course)
- `/study` — Review page (flashcards / self-test / follow-up / course-level AI)
- `/profile` — Me (account, settings, tags, server config)
- `/login` — Login page
- `/register` — Registration page
- `/server-config` — Server configuration page (first launch)
- `/session/:sid` — Session detail (transcript / playback / edit / whiteboard / share)
- `/summary/:sid` — AI summary page
- `/search` — Cross-course full-text search page
- `/schedule` — Schedule / import page
- `/voiceprints` — Voiceprint library page (admin only)
- `/syllabus` — Reference materials (official teaching syllabus)
- `/shared/:key` — Read-only share page (no login required)
- `/tags` — Tag management page

**Bottom tab navigation (5 tabs, with the center record button emphasized)**:
1. Home (`/`)
2. Courses (`/courses`)
3. Record (`/record`) — large center round button
4. Review (`/study`)
5. Me (`/profile`)

## 3. Core features
- [x] User login and registration (teacher/student roles)
- [ ] Server address configuration (first launch)
- [ ] Real-time recording + WebSocket binary PCM streaming
- [ ] Real-time caption stream (speaker separation, key-point/definition highlighting, English translation)
- [ ] Speaker renaming + voiceprint retroaction
- [ ] Whiteboard screenshots (photo upload, timeline alignment, lightbox viewing)
- [ ] AI real-time correction / smart sentence segmentation / English translation
- [ ] AI summary generation (including likely-misheard substitutions)
- [ ] Audio playback (seekable, playback speed, current sentence highlighted)
- [ ] Flashcards (Ebbinghaus spaced repetition)
- [ ] Self-test questions (answer graded right/wrong + explanation)
- [ ] Follow-up (multi-turn conversation + source citations)
- [ ] Course-level AI (summary / exam-point prediction / mock exam)
- [ ] Cross-course full-text search (grouped by course, keyword highlighting)
- [ ] Course grouping + per-course glossary + correction substitution table
- [ ] Schedule calendar (day/week/month views, import)
- [ ] Voiceprint library management (admin only)
- [ ] Reference materials (official teaching syllabus preview)
- [ ] Sharing (generate read-only link)
- [ ] Tag management
- [ ] Settings (AI default toggles, light/dark mode, pickup sensitivity)

## 4. Data storage
- Self-hosted Python backend service (REST + WebSocket); the app is only a client
- Server address, token, settings, etc. stored in localStorage
- Flashcard review progress stored in localStorage (key: sid + card index)
- All schedule/course/transcript/summary/voiceprint data stored on the backend, isolated per account

## 5. Backend / third-party integration
- **Self-hosted backend**: HTTPS + WebSocket, running on the user's own computer/server
- **No Supabase needed**: all data stored on the self-hosted backend
- **No third-party cloud services needed**: audio never leaves the device, and only text can optionally be sent to a large model

## 6. Development phase plan

### Phase 1: Mobile App Shell + Home + Auth (current phase)
- Goal: build a mobile-first app skeleton so users can see the overall framework on their phone
- Deliverables: bottom navigation, server config page, login/registration (wired to the real API), home console (stat cards + search shortcut + quick actions)

### Phase 2: Recording page (core feature)
- Goal: implement the full recording flow (ready → recording → ended)
- Deliverables: microphone permission request, WebSocket connection, 16kHz Int16 PCM streaming, real-time caption stream, speaker renaming, key-point marking, whiteboard photos, my notes, reconnection on drop

### Phase 3: Session detail + AI summary
- Goal: review past classes, generate and view AI summaries, audio playback
- Deliverables: session detail page (transcript/playback/edit/whiteboard/share/export), AI summary page (including likely-misheard substitutions), read-only share page

### Phase 4: Review features
- Goal: flashcards, self-test questions, follow-up, course-level AI
- Deliverables: flashcard system (Ebbinghaus), self-test questions, follow-up dialog, course-level AI (summary/exam points/mock exam)

### Phase 5: Search + Courses + Schedule
- Goal: cross-course search, course grouping, schedule calendar
- Deliverables: full-text search page, course grouping page, schedule calendar (day/week/month), import feature

### Phase 6: Advanced features
- Goal: voiceprint library, reference materials, settings polish
- Deliverables: voiceprint library page (admin), syllabus preview, Me/settings page polish, tag management
