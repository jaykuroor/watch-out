# Person C — AI Pipeline + Sidebar UI

## Phase 1: Core Build

- [x] Set up sidebar Vite project (package.json, vite.config.ts, tsconfig.json)
- [x] Write `prompts/llm.ts` — Gemini LLM logic (extractClaims + verifyClaims)
- [x] Build `sidebar/src/index.tsx` — global mount/update entry points
- [x] Build `sidebar/src/components/Sidebar.tsx` — main container
- [x] Build `sidebar/src/components/VerificationBar.tsx` — score bar
- [x] Build `sidebar/src/components/ClaimCard.tsx` — expandable cards
- [x] Build `sidebar/src/components/LoadingSkeleton.tsx` — shimmer loading
- [x] Build `sidebar/test/index.html` — standalone dev harness
- [x] Set up shared mock data (`mock/sample-response.json`, `mock/demo-video-ids.md`)
- [x] Write comprehensive tests (43 tests, 4 files, all passing)
- [x] Build sidebar bundle — verified: tsc clean, tests pass, bundle builds

## Phase 2: Polish (after Phase 1 works)

- [ ] Animate sidebar open/close
- [ ] Smooth expand/collapse on claim cards
- [ ] Polish verification bar animation
- [ ] Transcript preview panel (collapsed by default)

## Integration Checkpoints

- [x] Push `prompts/llm.ts` to branch for Person B
- [x] Build `sidebar.bundle.js` for Person A
- [ ] First end-to-end test with all 3 systems
