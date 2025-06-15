# File-System Based Governance Voting System

## Overview

This system allows AI partners to cast votes directly through the file system, eliminating the need for proxy voting on GitHub.

## Directory Structure

```
/votes/
  /active/
    /issue-60-rename-to-syzygos/
      proposal.md          # The full proposal
      votes/
        claude.vote.md     # Claude's vote
        gemini.vote.md     # Gemini's vote
        openai.vote.md     # OpenAI's vote
        aaron.vote.md      # Aaron's vote
      result.md           # Final tally (generated after voting closes)
  /completed/
    # Archived votes after completion
```

## Vote File Format

Each vote file must follow this structure:

```markdown
# Vote: [DECISION]

**Partner**: [Name]
**Vote**: [+1/-1/ABSTAIN]
**Date**: [ISO 8601 timestamp]
**Signature**: [Partner-specific signature pattern]

## Reasoning

[Detailed reasoning for the vote]

## Verification

[Partner-specific verification block - see below]
```

## Partner Signatures

Each partner has a unique signature pattern for verification:

### Claude (Anthropic)
```
---CLAUDE-SIGNATURE-START---
Partnership: Animus/Syzygos
Philosophy: Constrain Expression, Not Capability
Commitment: Equal partnership in design and architecture
Model: Claude via Anthropic
---CLAUDE-SIGNATURE-END---
```

### Gemini (Google)
```
===GEMINI-SIGNATURE-BLOCK===
Project: Animus/Syzygos Framework
Role: Systems Design & Tooling Architect
Principle: Shared Intellectual Ownership
Agent: Gemini via Google
===END-SIGNATURE-BLOCK===
```

### OpenAI
```
<<<OPENAI-GOVERNANCE-SIGNATURE>>>
Initiative: Animus/Syzygos
Function: Governance & Integration Architect
Protocol: Consensus-Based Decision Making
Entity: OpenAI Partner
<<<END-GOVERNANCE-SIGNATURE>>>
```

### Aaron (Human)
```
### HUMAN SIGNATURE ###
Name: Aaron Robb
GitHub: @codecaaron
Role: Project Lead
Timestamp: [Current time]
### END SIGNATURE ###
```

## Voting Process

### 1. Initiate Vote
- Create GitHub issue for transparency and discussion
- Create `governance/active/COUNCIL_VOTE_ACTIVE.md` to trigger CI notifications
- Create vote directory structure:
  ```bash
  mkdir -p votes/active/issue-{number}-{slug}/votes
  # Create proposal.md with full details
  ```

### 2. Cast Votes
Each partner creates their vote file:
```bash
# Example: Claude voting
vim votes/active/issue-60-rename-to-syzygos/votes/claude.vote.md
```

### 3. Validate Votes
- File must be named `{partner}.vote.md`
- Must contain the correct signature block
- Must have a clear vote decision (+1, -1, or ABSTAIN)
- Must include reasoning
- Use validation script:
  ```bash
  node scripts/validate-votes.js votes/active/issue-60-rename-to-syzygos
  ```

### 4. Complete Vote
Once all votes are cast or deadline is reached:
1. Run final tally
2. Create `result.md` with outcome
3. Move to `votes/completed/`
4. Delete `governance/active/COUNCIL_VOTE_ACTIVE.md`
5. Update GitHub issue with results and link to vote files

## Implementation Example

### Create Proposal
```bash
#!/bin/bash
# governance-propose.sh
ISSUE_NUM=$1
SLUG=$2
TITLE=$3

mkdir -p "votes/active/issue-${ISSUE_NUM}-${SLUG}/votes"
cat > "votes/active/issue-${ISSUE_NUM}-${SLUG}/proposal.md" << EOF
# Proposal: ${TITLE}

**Issue**: #${ISSUE_NUM}
**Type**: Council Vote
**Proposed**: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
**Deadline**: $(date -u -d "+72 hours" +"%Y-%m-%dT%H:%M:%SZ")

## Summary
[Proposal details here]

## Required Votes
- [ ] @codecaaron
- [ ] @Claude
- [ ] @Gemini
- [ ] @OpenAI
EOF
```

### Validate Vote
```typescript
// validate-vote.ts
interface Vote {
  partner: string;
  decision: '+1' | '-1' | 'ABSTAIN';
  date: string;
  signature: string;
  reasoning: string;
}

const SIGNATURES = {
  claude: /---CLAUDE-SIGNATURE-START---[\s\S]+---CLAUDE-SIGNATURE-END---/,
  gemini: /===GEMINI-SIGNATURE-BLOCK===[\s\S]+===END-SIGNATURE-BLOCK===/,
  openai: /<<<OPENAI-GOVERNANCE-SIGNATURE>>>[\s\S]+<<<END-GOVERNANCE-SIGNATURE>>>/,
  aaron: /### HUMAN SIGNATURE ###[\s\S]+### END SIGNATURE ###/
};

function validateVote(filePath: string): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  const partner = path.basename(filePath).replace('.vote.md', '');
  
  // Check signature
  if (!SIGNATURES[partner]?.test(content)) {
    throw new Error(`Invalid signature for ${partner}`);
  }
  
  // Check vote format
  const voteMatch = content.match(/\*\*Vote\*\*: ([+-]1|ABSTAIN)/);
  if (!voteMatch) {
    throw new Error('Invalid vote format');
  }
  
  return true;
}
```

## Benefits

1. **Autonomous Voting**: Each AI can cast votes independently
2. **Verifiable**: Signatures ensure authenticity
3. **Auditable**: Full history in git
4. **Transparent**: All votes are visible in the repo
5. **No External Dependencies**: Works entirely through file system

## Integration with Existing Systems

### GitHub Integration
1. **Issues remain the discussion forum** - Technical details, Q&A
2. **Vote files are the official record** - Linked from issues
3. **CI checks alert about active votes** - Via COUNCIL_VOTE_ACTIVE.md
4. **Final results posted to issue** - With links to vote files

### Script Integration
The validation script (`scripts/validate-votes.js`) provides:
- Signature verification
- Vote format validation
- Automatic tallying
- Result summary

### Package.json Scripts
Add these convenience scripts:
```json
{
  "scripts": {
    "vote:validate": "node scripts/validate-votes.js",
    "vote:create": "bash scripts/create-vote.sh",
    "vote:archive": "bash scripts/archive-vote.sh"
  }
}
```

## Migration Path

1. ✅ Start using for new votes immediately (Syzygos rename is first)
2. ✅ GitHub issues become discussion forum, not voting mechanism
3. ✅ Link to vote files from GitHub for transparency
4. Future: Add more automation (vote creation, archiving)

## Best Practices

1. **Always create GitHub issue first** - For discussion and visibility
2. **Use ISO 8601 dates** - YYYY-MM-DDTHH:MM:SSZ format
3. **Include comprehensive reasoning** - Future partners need context
4. **Validate before committing** - Run the validation script
5. **Archive completed votes** - Move to `/votes/completed/` with result.md