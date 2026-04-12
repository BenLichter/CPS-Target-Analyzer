# CPS Target Analyzer — Claude Code Reference

This file is the authoritative reference for Claude Code sessions working on this repository.

## Project Overview

CPS Target Analyzer is a Vite + React single-page application deployed on Vercel. It analyzes companies as CoinPayments sales targets using a multi-phase AI pipeline (Grok primary, Claude fallback) backed by Tavily search and NinjaPear contact enrichment. Pipeline deals are stored in Upstash Redis via serverless API routes in `/api/`.

## Stack

- **Frontend**: Vite + React (no TypeScript, no build framework beyond Vite)
- **Serverless API**: `/api/*.js` — Vercel Edge Functions (ESM, `export default async function handler(req, res)`)
- **Storage**: Upstash Redis via `/api/pipeline.js` — single key `cp_pipeline`
- **AI**: xAI Grok (`grok-3`, `grok-3-fast`) primary; Anthropic Claude fallback
- **Search**: Tavily API for live news, contact verification, event research, intent signal verification
- **Contacts**: NinjaPear API for executive enrichment
- **Presentations**: Gamma API (`public-api.gamma.app/v1.0`) for AI deck generation

## Code Conventions

- All React state uses `var sN = useState(...)` pattern — no `const`, no destructuring shorthand
- Hooks must all be declared before any conditional returns
- IIFE pattern `(function(){ var x=...; return <JSX/>; })()` used inside `.map()` for local variables
- No TypeScript, no prop-types
- Serverless functions use plain `fetch` — no axios or SDK wrappers

## Key Files

- `src/App.jsx` — entire frontend (single file)
- `api/pipeline.js` — Upstash Redis read/write for pipeline deals
- `api/gamma-start.js` — fire Gamma generation, return `generationId`
- `api/gamma-status.js` — poll Gamma generation status
- `api/gamma-theme.js` — apply dark theme to completed generation
- `api/gamma-test.js` — diagnostic endpoint for Gamma API debugging

## Git Workflow

- Feature branch: `claude/wire-up-storage-2uEsv`
- Always push to both the feature branch AND `main`:
  ```
  git push -u origin claude/wire-up-storage-2uEsv
  git push origin claude/wire-up-storage-2uEsv:main
  ```
- Never create a PR unless explicitly requested

## CoinPayments Core Value Proposition — Authoritative

**This is the single source of truth for all CoinPayments capability descriptions across AI prompts, competitive analyses, and deck generation. Never deviate from these descriptions or substitute generic crypto payment processor language.**

CoinPayments delivers one platform with four transformative capabilities — an API-driven infrastructure stack that eliminates the need for clients to build or maintain their own blockchain infrastructure, enabling instant, low-cost, 24/7 global payments with outsourced custody and compliance.

### 1. Stablecoin + Blockchain Rails
24/7 instant settlement bypassing correspondent banks. Automated FX conversions, zero pre-funding requirements, fractions of a cent per transaction.

### 2. Fiat On/Off Ramps
White-label tooling for local fiat ↔ stablecoin/crypto ↔ local fiat. Single UX, no intermediated conversion. Bank, card, and cash integration via regulated partners.

### 3. Third-Party Wallet Hosting
White-label, compliant MPC custody with insured cold/hot storage, automated reconciliation, and audit-ready reporting — fully outsourced key management.

### 4. Compliance-as-a-Service
Turnkey jurisdictional expansion across 180+ licensed jurisdictions and 40+ digital assets. AML/KYC, audit trails, and policy engines included.

### Usage in prompts

The constant `CP_CAPABILITIES` (defined at the top of `src/App.jsx`) contains this data as a formatted string and is prepended to:
- `P1_USER` — Phase 1 Grok core intelligence prompt
- `P2_USER` — Phase 2 competitive comparison prompt
- The Slide 3 section of `buildGammaDeck`'s deck generation prompt

When adding new AI prompts that describe CoinPayments, always prepend `CP_CAPABILITIES` or copy the four capability descriptions verbatim.

## Analysis Pipeline Phases

| Phase | Description | Model |
|---|---|---|
| 0a | Tavily live news search | — |
| 0b | NinjaPear contact enrichment | — |
| 0c | Deep scraping + contact verification | Tavily |
| 0d | Upcoming events research | Tavily + Grok |
| 1 | Core intelligence (company analysis, ARR, intent signals) | Grok-3 → Claude |
| 1b | News categorization | Grok-fast → Claude |
| 1c | Tavily intent signal URL verification | Tavily |
| 2 | Competitive comparison | Grok-3 → Claude |
| 3 | GTM attack plan | Grok-3 → Claude |
| 4 | Events (confirmed + likely) | Claude |

## Financial Methodology (ARR)

1. Find volume driver (AUM / payment volume / GGR etc.) from research data
2. Apply crypto adoption rate: 15-25% (already offering), 8-15% (exploring), 3-8% (early/none)
3. SOM = crypto adoption volume × 0.5% CoinPayments fee rate
4. Projected ARR = SOM × capture rate (1% early, 1.5% exploring, 2% deployed)
5. Upside ARR = SOM × 3%

## Sub-verticals (Financial Services)

| ID | Label |
|---|---|
| `remittance` | Remittance Fintechs |
| `brokerage` | FX & Brokerage |
| `neobanks` | Neobanks |

## Gamma Deck Generation

`buildGammaDeck` in `PipelineTab` runs four phases:
1. **🔍 Researching** — Grok Phase 1 independent intel query (returns `brand_name`, competitors, crypto gap)
2. **🧠 Building** — Grok Phase 2 deck narrative (4 slides, bespoke Slide 3 from CP_CAPABILITIES)
3. **🚀 Starting** — `POST /api/gamma-start` returns `generationId`
4. **🎨 ~Ns...** — client polls `GET /api/gamma-status` every 5s (max 30 attempts = 2.5 min)

Theme: `gamma-start.js` fetches available themes, selects dark basic, injects `themeId` in the generation payload. `gamma-theme.js` applies theme via PUT after completion as fallback.
