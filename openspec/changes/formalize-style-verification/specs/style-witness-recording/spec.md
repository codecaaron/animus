## ADDED Requirements

### Requirement: Witness comparison envelope

The witness surface SHALL expose an envelope carrying the manifest digest, build identity, analysis mode, and epoch of the running build, and cross-process consumers SHALL treat witness records without a matching envelope as non-comparable.

#### Scenario: Envelope available at the documented handle

- **WHEN** a development build with witness recording active is inspected at the documented global handle
- **THEN** the manifest digest, build identity, mode, and epoch of the producing build are readable alongside the records

#### Scenario: Mismatched envelope

- **WHEN** a consumer compares witness records against predictions derived from a manifest whose digest does not match the envelope
- **THEN** the comparison yields `unknown` rather than a static-versus-observed discrepancy claim
