# Extraction

Interpretation of authored Animus styling into deliverable styling and diagnostics.

## Language

**Build strictness**:
The policy governing whether classified extraction failures stop a build. It is separate from the admitted values of a styling prop.
_Avoid_: Unqualified strict mode, prop strictness.

**Configured transform**:
A transform bound through the loaded system's configuration.

**Project transform declaration**:
A transform definition found in an analyzed project module. Finding its declaration and establishing which prop owns its binding are separate facts.

**Admitted transform source**:
A transform callback source accepted under the applicable rules for evaluation and delivery. Admission does not guarantee that every input succeeds or that every host supplies the same facilities.

**Transform reference**:
A custom prop `transform` naming a callable declared in the same module or imported from an analyzed source module. It is delivered in place in the consuming module, through its own import when imported, so it keeps its lexical meaning without being an admitted transform source. An extension that inherits the prop reads the same callable from the extended parent's component, so the reference never moves into the extending module.
