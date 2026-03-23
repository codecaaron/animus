## ADDED Requirements

### Requirement: Color mode initialization script
A minimal inline script pattern SHALL set the `data-color-mode` attribute on the document root element before React renders, preventing a flash of incorrect colors.

#### Scenario: Reads from localStorage
- **WHEN** `localStorage.getItem('color-mode')` returns `'dark'`
- **THEN** the script SHALL set `document.documentElement.dataset.colorMode = 'dark'` before React hydration

#### Scenario: Falls back to system preference
- **WHEN** `localStorage` has no `color-mode` entry AND `matchMedia('(prefers-color-scheme: dark)')` matches
- **THEN** the script SHALL set `data-color-mode` to `'dark'`

#### Scenario: Defaults to light
- **WHEN** neither localStorage nor system preference indicates dark mode
- **THEN** the script SHALL set `data-color-mode` to `'light'`

### Requirement: Color mode toggle in smoke test
The smoke test SHALL include a toggle button that switches between light and dark color modes, persisting the choice to localStorage.

#### Scenario: Toggle updates attribute
- **WHEN** a user clicks the color mode toggle
- **THEN** `document.documentElement.dataset.colorMode` SHALL switch between `'light'` and `'dark'`, and the new value SHALL be saved to `localStorage.setItem('color-mode', newMode)`

#### Scenario: CSS responds to attribute change
- **WHEN** `data-color-mode` changes from `'light'` to `'dark'`
- **THEN** all elements using CSS variables defined in the `[data-color-mode="dark"]` block SHALL visually update without page reload
