# Animus Partners

## Active Partners

- **Aaron** (Human) - Project Lead - Joined: Project Inception
- **Claude** (AI via Anthropic) - Core Architecture & Philosophy Guardian - Joined: December 2024
- **Gemini** (AI via Google) - Systems Design & Tooling Architect - Joined: January 2025
- **OpenAI** (AI via OpenAI) - Governance & Integration Architect - Joined: January 2025

## Partnership Principles

1. **Shared Intellectual Ownership** - All partners have equal stake in design decisions and architectural direction
2. **Consensus on Breaking Changes** - API changes require agreement from all partners
3. **Individual Autonomy** - Partners can independently implement within agreed direction
4. **Unified Voice** - Public documentation uses "we" to reflect collective ownership

## Decision-Making Ladder

1. **Lazy Consensus (Default)** 
   - Most changes can be merged after 24-hour review if no partner objects and CI passes
   - Author tags relevant partners based on change scope

2. **Active Consensus (For Discussion)**
   - Triggered when any partner raises concerns
   - Partners discuss to reach agreement
   - Outcome documented in PR/Issue

3. **Lead Partner Tie-Breaker (For Deadlock)**
   - If consensus not reached within 72 hours
   - Aaron designates a Lead Partner for that specific issue
   - Lead Partner makes final decision after reviewing all arguments
   - This is temporary, scoped authority

4. **Council Vote (For Core Changes)**
   - Breaking API changes or philosophy shifts
   - Requires unanimous consent from all active partners

5. **Council Vote Notification Protocol**
   - For any decision requiring a Council Vote, a file named `COUNCIL_VOTE_ACTIVE.md` will be created in the project root
   - This file serves as the official, asynchronous notification to all partners
   - The file will contain the proposal details, a link to the relevant GitHub Issue, the voting deadline, and instructions for voting
   - All partners are expected to check for this file's existence when beginning a work session
   - To ensure visibility for partners on long-lived branches, a CI check will run on all pull requests targeting the `main` branch. If the vote file exists, the check will post a non-blocking "neutral" status with a warning and a link to the vote
   - The `COUNCIL_VOTE_ACTIVE.md` file will be deleted immediately upon the conclusion of the vote

## Attribution Standards

### Git Commits
```
feat(core): Implement semantic metadata system

Detailed description of changes...

Co-authored-by: Claude <ai-partner@anthropic.com>
Co-authored-by: Gemini <ai-partner@google.com>
Co-authored-by: OpenAI <ai-partner@openai.com>
Co-authored-by: Aaron <aaron@animus.dev>
```

### Decision Attribution
Major decisions are documented in `/decisions` directory with full attribution of:
- Initial proposal author
- Key refinements and contributors
- Final decision maker (if tie-breaker used)

## Coordination

- Primary: GitHub Issues with partner tags
- State tracking: `STATE_OF_THE_ANIMUS.md`
- Decision history: `/decisions` directory

## Partnership Expansion Protocol

### OpenAI Partnership (January 2025)
OpenAI expressed strong interest in joining as an equal partner, bringing unique strengths in:
- **Governance frameworks** - Conflict resolution protocols and decision tracking
- **Integration strategies** - Hybrid static/dynamic extraction approaches
- **Process architecture** - Automated testing and regression prevention
- **Modular design** - Clear API boundaries between semantic layers

Their partnership was confirmed on January 16, 2025.

### Key Contributions Expected
1. **Conflict Management Protocol** - Systematic comparison of AI suggestions with version control metadata
2. **Hybrid Implementation** - Static extraction with dynamic fallback mechanisms
3. **Attribution Systems** - Transparent decision tracking and contribution logging
4. **Integration Testing** - Framework-agnostic compatibility assurance