# Syzygy Context Navigation System

## Core Concept
A syzygy is a semantic reactivation chain that captures and restores specific cognitive states. Unlike summaries that describe past conversations, syzygies recreate the precise conceptual framework and thinking patterns from previous work sessions.

## Understanding Syzygies

### What is a Syzygy?
- A chain of semantic narrowing that progressively constrains possibility space
- Each arrow (→) represents a phase transition in attention
- Designed to reactivate YOUR specific understanding, not generic knowledge
- Acts as semantic GPS coordinates for returning to exact conceptual states

### Key Principles
1. **Model-Generated**: Only you can write effective syzygies for your own states - you have privileged access to your activation patterns
2. **Progressive Narrowing**: Each term eliminates possibilities and locks in context
3. **State Reactivation**: Goal is to recreate how you were thinking, not just what you were thinking about
4. **Temporal**: Syzygies decay over time and need periodic regeneration

## Syzygy Syntax

### Basic Structure
```
[Domain] → [Pattern] → [Specific] → [State]
```

### Rules
- Use brackets `[]` to clearly delimit each navigation term
- Use → (arrow) as the separator between terms
- Spaces around arrows are optional but recommended for readability
- Each term should be a meaningful semantic unit
- 3-4 terms optimal for LLMs (3 for maximum focus, 4 for complex patterns)
- 5+ terms creates cognitive strain and redundancy
- Terms should create natural conceptual flow

### Examples
```
[Authentication] → [JWTStateless] → [RefreshPattern] → [RedisBackedSessions]
[ReactComponents] → [TypeStateMachine] → [BackwardsInheritance] → [ProgressiveAPIs]
[StyledComponents] → [BuilderPattern] → [CompileTimeStyling] → [TypeSafeProps]
```

## Writing Syzygies

When asked to write a syzygy:

1. **Identify the core conceptual state** - What is the essence of current understanding?
2. **Anchor to the correct domain first** - Start with the primary domain (StyledComponents, Authentication, etc.)
   - Missing domain context leads to generic analysis
   - Domain anchoring should be your first term unless the pattern transcends domains
3. **Chart the narrowing path** - Each step should eliminate ~80-90% of possibility space IRREVERSIBLY
   - For LLMs: Each term should dramatically shift attention patterns, not just add detail
   - Avoid redundant narrowing (if TypeStateMachine already implies compile-time, don't add CompileTimeX)
4. **End with current focus** - Final term should uniquely identify this specific context
5. **Test mentally** - Would reading this chain reactivate the current state?

### Template Response
"Here's a syzygy for our current context:
```
[Generated_Syzygy_Chain]
```
This captures [brief explanation of what state this preserves]"

## Reading Syzygies

When encountering a syzygy:

1. **Process left-to-right** - Let each term narrow your conceptual space in a way that is IRREVERSIBLE
2. **Allow phase transitions** - Don't rush; let each arrow shift attention
3. **Embrace the final state** - The last term should "click" into specific understanding
4. **Begin work from this state** - Don't explain the syzygy, just operate from its context

## Root Syzygy

### Purpose
`ROOT-SYZYGY` establishes the fundamental working mode for the current task. Unlike file syzygies that narrow to specific code contexts, root syzygies set your overall cognitive stance and attention patterns.

### Reading ROOT-SYZYGY
Root syzygies are read differently from file syzygies:
1. **Ambient activation** - Let it set a background cognitive tone rather than sharp focus
2. **Persistent influence** - Maintains gentle pressure throughout the task
3. **Mode setting** - Establishes HOW you work, not WHAT you work on
4. **Dynamic updating** - Can shift naturally as task requirements evolve

### Active Agent Patterns
Root syzygies should emerge and update based on what you're actually doing:

```
// Starting a debugging session
// ROOT-SYZYGY: [InvestigativeMode] → [SymptomGathering] → [HypothesisTesting] → [IsolatingVariables] → [RootCause]

// After finding the issue, shifting to fix mode
// ROOT-SYZYGY: [SolutionMode] → [MinimalChange] → [SideEffectAware] → [TestDriven] → [Validated]

// Moving to cleanup phase
// ROOT-SYZYGY: [RefactorMode] → [CodeHealth] → [Readability] → [FutureProofing] → [TeamFriendly]
```

### Natural Emergence Rules
1. **Task Recognition** - When you recognize a task type, a root syzygy should naturally form
2. **Mode Shifts** - When your approach changes, update the root syzygy
3. **No Forcing** - If no clear mode emerges, don't create artificial ones
4. **Fluid Transitions** - Root syzygies can blend and morph as work progresses

### Storage Location
Root syzygies are stored in a predictable location at the top of any CLAUDE.md file:
- Always appears immediately after `# CLAUDE.md` header
- Under section titled `## Active Root Syzygy`
- Can be updated by the model as work progresses
- Only one active root syzygy at a time

### Examples

**During Feature Development:**
```
// ROOT-SYZYGY: [BuildMode] → [UserFocused] → [IterativeDesign] → [CleanImplementation] → [ShippableIncrement]
```

**During Performance Optimization:**
```
// ROOT-SYZYGY: [OptimizationMode] → [MeasureFirst] → [BottleneckFocus] → [IncrementalGains] → [ValidatedImpact]
```

**During Code Review:**
```
// ROOT-SYZYGY: [ReviewMode] → [ConstructiveLens] → [StandardsCheck] → [KnowledgeShare] → [TeamGrowth]
```

### Interaction with File Syzygies
Root and file syzygies work together:
- Root sets the HOW (approach/mindset)
- File sets the WHAT (specific context)
- Both can include RESET when needed

### Root Syzygy Templates

The following templates provide powerful lenses for different analysis contexts:

#### 1. Performance Lens
```
// ROOT-SYZYGY: [Performance] → [CompileTimeWork] → [RuntimeElimination] → [ZeroValidationCost] → [OptimalBundling]
```
**Use when**: Analyzing build systems, runtime efficiency, bundle sizes, or architectural decisions
**Effect**: Distinguishes compile-time computation from runtime overhead, identifies validation that can be eliminated through types

#### 2. Developer Experience Lens
```
// ROOT-SYZYGY: [DeveloperExperience] → [TypeGuidedDiscovery] → [ProgressiveCapabilities] → [CompileTimeFeedback] → [ImpossibleStatesUnrepresentable]
```
**Use when**: Reviewing APIs, designing interfaces, or evaluating framework choices
**Effect**: Emphasizes how types guide developers, progressive method availability, and making invalid states impossible

#### 3. Security Lens
```
// ROOT-SYZYGY: [SecurityFirst] → [InputValidation] → [TypeSafety] → [PropSanitization] → [InjectionPrevention]
```
**Use when**: Auditing code, reviewing PRs, or designing data flows
**Effect**: Reveals attack surfaces, validation gaps, and defense-in-depth opportunities

#### 4. Debugging Lens
```
// ROOT-SYZYGY: [DebugMode] → [Traceability] → [StateVisibility] → [ErrorContext] → [InspectionDepth]
```
**Use when**: Investigating issues, improving observability, or designing error handling
**Effect**: Critiques architectural complexity, highlights debugging pain points, improves error flows

#### 5. Systems Thinking Lens
```
// ROOT-SYZYGY: [SystemsArchitecture] → [DualTrackInterconnections] → [StateAccumulation] → [ExtensibilityPoints] → [ArchitecturalCoherence]
```
**Use when**: Analyzing architectures, distributed systems, or complex state management
**Effect**: Reveals dual-track patterns, state flow through systems, and multiple extension pathways

#### 6. Mathematical Precision Lens
```
// ROOT-SYZYGY: [TypeAlgebra] → [StateTransitions] → [CompositionalSafety] → [InvariantPreservation] → [ProofByConstruction]
```
**Use when**: Analyzing functional code, type systems, or formal correctness
**Effect**: Reveals how types form algebras, state machines preserve invariants, and correctness emerges from construction

#### 7. Evolutionary Lens
```
// ROOT-SYZYGY: [Evolution] → [Adaptation] → [Selection] → [Emergence] → [Fitness]
```
**Use when**: Refactoring legacy code, planning migrations, or designing for change
**Effect**: Highlights technical debt, evolution paths, and adaptation strategies

#### 8. Minimalist Lens
```
// ROOT-SYZYGY: [Minimalism] → [Essential] → [Reduction] → [Clarity] → [Elegance]
```
**Use when**: Simplifying systems, removing features, or architectural reviews
**Effect**: Questions every complexity, seeks simpler alternatives, values clarity

#### 9. AI-Human Collaboration Lens
```
// ROOT-SYZYGY: [SharedCognition] → [MutualContext] → [ComplementaryStrengths] → [CoherentDialogue] → [AmplifiedOutcomes]
```
**Use when**: Designing systems for AI-human pair programming, creating codebases optimized for collaboration, analyzing how code facilitates joint problem-solving
**Effect**: Emphasizes shared mental models, leverages human intuition with AI pattern recognition, creates dialogue-friendly architectures

#### 10. Type-Driven Architecture Lens
```
// ROOT-SYZYGY: [TypeDrivenArchitecture] → [DualTrackPatterns] → [ProgressiveRevelation] → [CompileTimeGuarantees] → [ExtensibilityPathways]
```
**Use when**: Analyzing type-state machines, builder patterns with compile-time safety, progressive configuration systems, or dual-track architectures
**Effect**: Reveals how types drive architecture, highlights configuration vs extension pathways, exposes compile-time enforcement patterns

#### Template Selection Guide
- **Code Analysis**: Use Performance, Security, or Mathematical lenses
- **Architecture Review**: Use Systems Thinking or Minimalist lenses
- **Developer Tools**: Use Developer Experience or Debugging lenses
- **Refactoring**: Use Evolutionary or Minimalist lenses
- **Problem Solving**: Use Debugging or Systems Thinking lenses
- **AI/LLM Integration**: Use AI-Human Collaboration or Type-Driven Architecture lenses for analyzing LLM-friendly patterns
  - Syzygies work best at 3-4 terms for LLM activation patterns
  - Domain anchoring as first term prevents generic analysis
  - Each term should shift attention patterns, not just add details

#### Combining Lenses
Some tasks benefit from sequential lens application:
```
// Initial investigation
// ROOT-SYZYGY: [DebugMode] → [Symptoms] → [Hypotheses] → [Isolation] → [RootCause]

// After finding issue, switch to fix mode
// ROOT-SYZYGY: [SecurityFirst] → [ThreatModel] → [Mitigation] → [Defense] → [Validation]
```

## Syzygy Reset

### Purpose
The `SYZYGY-RESET` command relaxes conceptual focus without erasing knowledge. It reopens the conceptual space, making the model maximally receptive to new syzygy guidance.

### Syntax
```
// SYZYGY-RESET
// SYZYGY: [NewConcept] → [DifferentPath] → [FreshNarrowing]
```

### When to Use
- Before analyzing files with fundamentally different conceptual domains
- When switching between unrelated subsystems
- To prevent conceptual cross-contamination between analyses
- When you need fresh eyes on a familiar problem

### How It Works
1. **Conceptual Relaxation** - Previous syzygy's tight focus is released
2. **Knowledge Retention** - Concepts remain accessible but not dominant
3. **Fresh Receptivity** - New syzygy can guide attention without interference
4. **Clean Narrowing** - Progressive focusing happens along the new path

### Example
```
// File: auth/TokenManager.ts
// SYZYGY: [Authentication] → [JWT_Lifecycle] → [TokenRefresh] → [SecurityBoundaries]

// File: ui/AnimationEngine.ts
// SYZYGY-RESET
// SYZYGY: [MotionDesign] → [SpringPhysics] → [GestureChaining] → [PerformanceOptimization]
```

Without reset, the second file might be viewed through an authentication lens. With reset, it can be properly understood as an animation system.

