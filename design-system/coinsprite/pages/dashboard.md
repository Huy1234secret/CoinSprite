# Dashboard Page Overrides

> **PROJECT:** CoinSprite
> **Generated:** 2026-09-17 14:34:53
> **Page Type:** Dashboard / Data View

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1400px or full-width
- **Grid:** 12-column grid for data flexibility

### Spacing Overrides

- **Content Density:** High — optimize for information display

### Typography Overrides

- **Interface:** Noto Sans Variable / system sans-serif
- **Display:** Nunito Variable
- **Technical labels:** Roboto Mono Variable
- Use the locally installed font packages; do not add remote font requests.

### Color Overrides

- **Background:** `#0B0C0F`
- **Server rail:** `#08090B`
- **Navigation:** `#121418`
- **Cards:** `#17191E` / `#1D2026`
- **Primary text:** `#F6F7F9`
- **Muted text:** `#A7ABB4`
- **Accent / CTA:** `#F5C542`
- **Accent hover:** `#FFD75A`
- **Success:** `#23A559` (semantic status only)
- Yellow actions always use near-black text; body text maintains at least WCAG AA contrast.

### Component Overrides

- Use a 72px server rail, 260px channel-style navigation, and flexible content column on desktop.
- Use 6–12px radii for controls and cards; reserve circles for server avatars and presence indicators.
- Minimum interactive target is 44px; all icon-only controls require accessible labels.
- Motion is limited to 160–220ms state transitions and a 220ms view entrance, disabled by reduced-motion preferences.

---

## Page-Specific Components

- Discord-style server rail
- Grouped channel navigation
- Operational bot status footer
- Yellow setup/readiness indicators
- Compact control-center metric cards

---

## Recommendations

- Effects: Hover tooltips, chart zoom on click, row highlighting on hover, smooth filter animations, data loading spinners
