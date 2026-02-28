# Person C — AI Pipeline + Sidebar UI

## Phase 1: Core Build

- [ ] Set up sidebar Vite project (package.json, vite.config.ts, tsconfig.json)
- [ ] Write `prompts/llm.ts` — Gemini LLM logic (extractClaims + verifyClaims)
- [ ] Build `sidebar/src/index.tsx` — global mount/update entry points
- [ ] Build `sidebar/src/components/Sidebar.tsx` — main container
- [ ] Build `sidebar/src/components/VerificationBar.tsx` — score bar
- [ ] Build `sidebar/src/components/ClaimCard.tsx` — expandable cards
- [ ] Build `sidebar/src/components/LoadingSkeleton.tsx` — shimmer loading
- [ ] Build `sidebar/test/index.html` — standalone dev harness
- [ ] Set up shared mock data (`mock/sample-response.json`, `mock/demo-video-ids.md`)
- [ ] Write comprehensive tests for all components and LLM logic
- [ ] Build sidebar bundle and verify it works end-to-end

## Phase 2: Polish (after Phase 1 works)

- [ ] Animate sidebar open/close
- [ ] Smooth expand/collapse on claim cards
- [ ] Polish verification bar animation
- [ ] Transcript preview panel (collapsed by default)

## Integration Checkpoints

- [ ] Hand `prompts/llm.ts` to Person B
- [ ] Hand `sidebar.bundle.js` to Person A
- [ ] First end-to-end test with all 3 systems
