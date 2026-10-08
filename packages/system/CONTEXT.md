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

**Declaration scale**:
A finite theme vocabulary whose keys each name one complete record of CSS declarations; every record sets the same members.
_Avoid_: Composite token, for a scale whose values are single CSS values.

**Declaration prop**:
A system or component prop bound to a declaration scale. A key applies every member of its record, whether the key is written literally or selected at runtime.
_Avoid_: Multi-property prop, for a value prop with several `properties`.

**Declaring identity**:
The component whose `.props()` declares a component declaration prop. Its member variables belong to that identity: an extension inherits them until it redeclares the prop, and unrelated components never read them. System declaration props share one namespace.

**Atomic drop**:
Removal of all styling contributions of an affected prop while preserving contributions of other props.
