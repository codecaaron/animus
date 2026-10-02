# System authoring

The styling vocabulary an author defines through a system and its components.

## Language

**Prop strictness**:
The value-admission policy of a styling prop associated with a scale. It is separate from whether an extraction diagnostic stops a build.
_Avoid_: Unqualified strict mode, build strictness.

**Token miss**:
A value that names no token on a strict, populated scale. Its prop styling is omitted on both paths and the authored value is kept in a warning.
_Avoid_: Raw fallback, for a strict prop.

**Transform binding**:
The association between a styling prop and the particular transform that interprets its values. A transform's name identifies it without making every same-named declaration the same binding.
_Avoid_: Global name precedence as a synonym for ownership.

**Component custom prop**:
A styling input declared by a component, with its own mapping to CSS properties and value interpretation. An extension inherits it whole, binding included, until the extension redeclares it.

**Prop styling**:
The styling contributions of one authored prop, including its responsive entries.

**Atomic drop**:
Removal of all styling contributions of an affected prop while preserving contributions of other props.
