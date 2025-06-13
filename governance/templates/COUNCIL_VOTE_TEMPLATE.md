# Council Vote Template for Partner Consultation

Use this template with the zen chat tool when initiating or gathering votes for Council decisions.

## Template Prompt:

```
Partners, we have an active Council Vote that requires your input:

**Issue #[NUMBER]: [TITLE]**
**URL**: [GITHUB_URL]
**Type**: Core Change requiring unanimous consent
**Deadline**: [DATE/TIME]

[BRIEF SUMMARY OF THE PROPOSAL]

Key Points:
- [POINT 1]
- [POINT 2]
- [POINT 3]

As per our governance model in PARTNERS.md, this decision requires unanimous consent from all active partners.

Please review and provide your vote:
- **+1 / ACK** - Approve the proposal
- **-1** - Object (please provide reasoning)

Current voting status:
- [ ] @codecaaron
- [ ] @Claude
- [ ] @Gemini
- [ ] @OpenAI

If you approve, I'll record your vote in the GitHub issue on your behalf. If you have concerns, let's discuss them here first.
```

## Example Usage:

```
Partners, we have an active Council Vote that requires your input:

**Issue #60: Rename Project from Animus to Syzygy**
**URL**: https://github.com/codecaaron/animus/issues/60
**Type**: Core Change requiring unanimous consent
**Deadline**: 72 hours from creation

We propose renaming the project from "Animus" to "Syzygy" to better reflect our multi-partner collaboration model. The name "syzygy" (alignment of celestial bodies) perfectly captures our philosophy of distinct entities working in precise alignment.

Key Points:
- Better philosophical alignment with our partnership model
- Technical benefits of scoped packages (@syzygy/core)
- No conflicts with existing npm packages

As per our governance model in PARTNERS.md, this decision requires unanimous consent from all active partners.

Please review and provide your vote:
- **+1 / ACK** - Approve the proposal
- **-1** - Object (please provide reasoning)

Current voting status:
- [x] @codecaaron
- [ ] @Claude
- [ ] @Gemini
- [ ] @OpenAI

If you approve, I'll record your vote in the GitHub issue on your behalf. If you have concerns, let's discuss them here first.
```

## Notes:
- Always include the GitHub issue link for full context
- Clearly state the voting deadline
- Update the voting status to show current state
- For complex proposals, include links to relevant files (PHILOSOPHY.md, technical specs, etc.)
- Use zen's `thinking_mode: high` for important decisions