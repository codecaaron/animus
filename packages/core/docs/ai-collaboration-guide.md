# AI Agent Collaboration Guide for Animus Babel Plugin

## Purpose
This guide helps human developers effectively collaborate with AI agents (Claude, GPT-4, etc.) on implementing the Animus Babel plugin tasks. Each task is designed to be self-contained and delegatable.

## How to Request Help from AI Agents

### Task Assignment Template
When asking an AI agent to implement a specific task, use this template:

```markdown
I'm working on the Animus CSS-in-JS library's static extraction feature. 
I need help implementing [TASK NAME] from the requirements document.

Context files to review:
- /packages/core/docs/babel-plugin-requirements.md (Task [NUMBER] section)
- /packages/core/docs/babel-plugin-architecture.md
- /packages/core/src/static-poc/ (proof of concept implementation)

The task contract is:
[PASTE THE SPECIFIC TASK CONTRACT HERE]

Please implement this according to the specifications.
```

### Optimal Task Delegation

#### Best for AI Agents:
1. **Task 1: AST Visitor Pattern** - Pattern matching and AST traversal
2. **Task 3: Class Name Generator** - Deterministic algorithms  
3. **Task 6: Theme Integration** - Token resolution logic
4. **Task 2: Style Extractor** - Rule-based transformations

#### Best for Human Developers:
1. **Task 7: Build Tool Integration** - Requires specific tool knowledge
2. **Task 8: Extension Chain Resolver** - Complex state management
3. **Task 5: CSS Output Manager** - File system operations

## AI Agent Instructions

### For Any AI Agent Working on These Tasks:

1. **Review Order**:
   - Read the specific task section in requirements.md
   - Review the architecture overview
   - Check the POC implementation for patterns
   - Look at existing Animus core code for style patterns

2. **Implementation Guidelines**:
   - Follow the TypeScript contracts exactly
   - Include comprehensive error handling
   - Add JSDoc comments for public APIs
   - Write unit tests alongside implementation
   - Use existing Animus patterns (check packages/core/src)

3. **Code Style**:
   - Use functional programming where appropriate
   - Prefer immutability
   - Clear, descriptive variable names
   - No unnecessary comments (code should be self-documenting)

4. **Testing Requirements**:
   - Unit tests for all public methods
   - Edge case coverage
   - Integration test for the complete flow
   - Performance benchmarks for critical paths

## Example AI Agent Prompts

### For Style Extractor Implementation:
```
I need to implement the Style Extractor (Task 2) for the Animus Babel plugin.
The extractor should parse AST nodes and convert style objects to atomic CSS.

Requirements:
- Handle theme tokens ($space.md → var(--space-md))
- Support responsive arrays
- Return null for non-extractable styles
- Generate deterministic class names

Please implement StyleExtractor.ts with the provided contract interface.
```

### For Class Name Generator:
```
Implement the Class Name Generator (Task 3) for Animus static CSS extraction.
It should create atomic CSS class names like "_p-1rem" for "padding: 1rem".

Requirements:
- Deterministic (same input → same output)
- Handle special characters safely
- Support collision detection
- Configurable naming strategies

Include unit tests covering edge cases like spaces, hashes, and quotes.
```

## Sharing Results

When an AI agent completes a task:

1. **Create a PR** with:
   - Implementation in the correct directory
   - Unit tests
   - Integration test if applicable
   - Updates to this guide if patterns emerged

2. **Document Learnings**:
   - Add any discovered edge cases
   - Note any architectural decisions
   - Update contracts if needed

3. **Share Context**:
   - Export conversation as markdown
   - Include in PR description
   - Help future AI agents learn from the work

## Success Metrics for AI Implementation

- Passes all unit tests
- Follows TypeScript contracts exactly
- Handles edge cases gracefully
- Maintains Animus code style
- Includes helpful error messages
- Performance meets benchmarks

## Common Pitfalls to Avoid

1. **Don't assume Babel APIs** - Check Babel 7 documentation
2. **Don't modify shared state** - Keep transforms pure
3. **Don't forget error boundaries** - Graceful degradation is key
4. **Don't over-optimize early** - Correctness first, performance second

## Resources for AI Agents

- Babel Handbook: https://github.com/jamiebuilds/babel-handbook
- AST Explorer: https://astexplorer.net/
- Animus Core Source: /packages/core/src/
- POC Implementation: /packages/core/src/static-poc/

Remember: The goal is to maintain 100% API compatibility while extracting static CSS at build time. When in doubt, fall back to runtime generation rather than breaking user code.