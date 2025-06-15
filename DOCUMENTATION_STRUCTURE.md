# Animus/Syzygy Documentation Structure

This document defines the canonical structure for all markdown documentation in the project.

## Directory Structure

```
/
├── README.md                    # Project overview and quick start
├── CHANGELOG.md                 # Version history
├── LICENSE.md                   # License information
├── CLAUDE.md                    # AI assistant instructions
│
├── docs/                        # Primary documentation
│   ├── guides/                  # How-to guides and tutorials
│   ├── reference/               # API and technical reference
│   ├── architecture/            # Architecture and design docs
│   │   ├── static-extraction/   # Static extraction feature docs
│   │   └── babel-plugin/        # Babel plugin architecture
│   └── archive/                 # Historical/deprecated docs
│
├── governance/                  # Governance and partnership docs
│   ├── PARTNERS.md             # Partnership principles and members
│   ├── GOVERNANCE.md           # Governance processes
│   ├── VOTING_SYSTEM.md        # Voting system documentation
│   ├── templates/              # Templates for governance processes
│   │   └── COUNCIL_VOTE.md     # Council vote template
│   └── active/                 # Active governance items
│       └── COUNCIL_VOTE_ACTIVE.md  # Current active votes
│
├── decisions/                   # Architecture Decision Records (ADRs)
│   └── YYYY-MM-DD-*.md         # Individual decision records
│
├── votes/                       # Governance voting records
│   ├── active/                  # Active votes
│   │   └── issue-{num}-{slug}/ # Individual vote directories
│   └── completed/               # Archived completed votes
│
├── project/                     # Project management docs
│   ├── STATE_OF_THE_PROJECT.md # Current project state
│   ├── ROADMAP.md              # Future plans
│   ├── TECHNICAL_OVERVIEW.md   # Technical reference
│   ├── PHILOSOPHY.md           # Project philosophy
│   └── checklists/             # Implementation checklists
│       └── RENAME_CHECKLIST.md # Specific task checklists
│
├── partnerships/                # AI partnership specific docs
│   ├── AI_AGENT_BRIEF.md      # Brief for AI partners
│   ├── INSIGHTS.md             # Partnership insights
│   └── UPDATES.md              # Partnership updates
│
└── packages/                    # Package-specific docs
    └── {package}/
        ├── README.md           # Package overview
        ├── CHANGELOG.md        # Package version history
        ├── CLAUDE.md           # Package-specific AI instructions
        └── docs/               # Package documentation
            ├── guides/         # Package-specific guides
            └── reference/      # Package API reference
```

## Document Placement Rules

### Root Level (`/`)
- **Keep here**: README.md, CHANGELOG.md, LICENSE.md, CLAUDE.md
- **Why**: Standard project files expected at root

### `/docs`
- **Purpose**: All general project documentation
- **Subfolders**:
  - `guides/`: Step-by-step tutorials, how-tos
  - `reference/`: API docs, technical specifications
  - `architecture/`: System design, architectural decisions
  - `archive/`: Deprecated or historical documentation

### `/governance`
- **Purpose**: All governance-related documentation
- **Keep here**: Partnership docs, voting systems, templates
- **Active items**: Live in `active/` subdirectory

### `/decisions`
- **Purpose**: Architecture Decision Records (ADRs)
- **Format**: `YYYY-MM-DD-description.md`
- **Example**: `2025-06-12-rename-to-syzygy.md`

### `/votes`
- **Purpose**: Formal voting records
- **Structure**: Each vote gets its own directory
- **Lifecycle**: Moves from `active/` to `completed/`

### `/project`
- **Purpose**: Project management and planning
- **Keep here**: State docs, roadmaps, checklists
- **Note**: Rename STATE_OF_THE_ANIMUS.md → STATE_OF_THE_PROJECT.md

### `/partnerships`
- **Purpose**: AI partnership collaboration docs
- **Keep here**: All AI agent-specific documentation

### `/packages/{name}`
- **Purpose**: Package-specific documentation
- **Standard files**: README.md, CHANGELOG.md, CLAUDE.md
- **Detailed docs**: In `docs/` subdirectory

## Migration Plan

1. Create new directory structure
2. Move existing files to appropriate locations
3. Update all internal links
4. Add redirects/notes for moved files
5. Update CLAUDE.md with new structure

## Future Document Guidelines

When creating new documentation:

1. **Governance docs** → `/governance`
2. **Technical decisions** → `/decisions`
3. **How-to guides** → `/docs/guides`
4. **API reference** → `/docs/reference`
5. **Architecture docs** → `/docs/architecture`
6. **Partnership updates** → `/partnerships`
7. **Project planning** → `/project`
8. **Package-specific** → `/packages/{name}/docs`

This structure provides clear separation of concerns and makes documentation discoverable.
