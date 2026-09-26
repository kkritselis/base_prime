# Design Reference: Base Power Style

Pulled from the live CSS of basepowercompany.com on Sep 25, 2026 (their design tokens use a `--bpc-` prefix).
Use this to make the hackathon app feel at home with Base's brand. Don't use their logo or present the app as an official Base product.
Label it something like "Built for the Base Power × AITX Hackathon."

---

## 1. Brand overview

**Positioning:** "The power company bringing affordable, reliable energy to homes across America." Base is a *power company*
(retail electricity + a home battery), not a battery vendor.

**Headline / tagline:** **Save money. Stay powered.**

**Core promise (two jobs, one product):**
- **Grid ON:** "Base helps the grid when demand is high." Batteries fill peak-demand gaps, and that revenue keeps member rates low.
- **Grid OFF:** "When the power goes out, Base helps keep homes running." Backup kicks in automatically. "Most members don't even notice."
- Key line: **"We earn from the grid, not you."**

**Product: Base Core battery**
- 39.2 kWh, "one of the largest home batteries available"
- About 36–72 hours of backup (1–2 batteries). Can be extended with a generator recharge port or solar.
- Rated for -22 to 122°F and flash flooding; submersion-rated to 3 ft

**Plans:** Energy (low, fixed rates) · Backup + Energy · Backup Only (select areas)
- Oncor example: **13.9¢/kWh** all-in, **$695** one-time install (vs ~$13,000 for a generator), **$19/mo** membership, ~13.8% avg savings vs market

**Social proof:** 30,000+ homes in Texas and Illinois · 4.8 stars · investor/member JJ Watt · member stories from Waxahachie, Cypress,
Arlington, Houston. The recurring themes are hurricanes, frequent outages, and "cheaper than a generator."

**Voice & tone:** plain, confident, homeowner-first. Short declarative headlines ("A better way to power your home.",
"Power your home your way."). Numbers are specific and upfront (39.2 kWh, $695, 13.9¢). Warm and a bit Texan
("Loved by thousands of Texans," "Built in Austin, TX"). No jargon. Grid concepts are explained in one sentence.

**What this means for our app:** the pitch lines up with Base's story. Outages are mostly *local* events, and Base's answer is
*backup at the home*. Use their language: "stay powered," "peace of mind," "whole-home backup," "members."

---

## 2. Color

### Named brand colors (Base's own names)
| Name | Token | Hex | Use |
|---|---|---|---|
| **Terminal** | grey-100 | `#292826` | Default text |
| **Conduit** | grey-5 | `#F0EEEB` | Page background (warm off-white) |
| **Grounded** | green-90 | `#1E4D2B` | Brand text, dark surfaces, headings |
| **Livewire** | green-20 | `#B2DD79` | **Primary brand / CTA background** |
| **Energy** | orange-60 | `#ED6C30` | Accent, energy/alert moments |
| **Goldenrod** | yellow-20 | `#F7C33C` | Accent (very common on the page) |
| **Texas Sky** | blue-60 | `#048EE5` | Accent, info |
| **Strike** | white | `#FFFFFF` | Raised surfaces, inverse text |

### Full ramps
- **Grey:** 100 `#292826` · 80 `#54524F` · 60 `#7F7D7A` · 40 `#A9A8A7` · 20 `#D8D7D5` · 5 `#F0EEEB`
- **Green:** 100 `#102A17` · 90 `#1E4D2B` · 60 `#77A45A` · 20 `#B2DD79` · 5 `#D6F0B4`
- **Orange:** 90 `#742C0B` · 60 `#ED6C30` · 40 `#F09064` · 5 `#FBE3D8`
- **Blue:** 100 `#07314B` · 80 `#06507E` · 60 `#048EE5` · 40 `#68BAED` · 10 `#CCE5F5`
- **Yellow:** 80 `#5E4507` · 60 `#AA8422` · 20 `#F7C33C` · 10 `#F9D77D` · 5 `#FDF1D3`
- **Red:** 80 `#C51808` · 20 `#FF948A` · 5 `#FFCCC7`

### Semantic roles
- Text: default `grey-100`, muted `grey-60`, disabled `grey-40`, brand/link `green-90`, error `red-80`, inverse `white`
- Surface: default `grey-5`, raised `white`, subtle `grey-20`, **dark `green-90`**
- Border: default `grey-20`, strong `grey-80`, active `grey-100`
- Primary button: bg `green-20`, text `green-90`, hover `green-60`, active `green-100`, subtle `green-5`

### Suggested map/heatmap scale (our app)
- Resilience score (low → high), a sequential ramp built from their palette:
  `#D6F0B4` → `#B2DD79` → `#F7C33C` → `#ED6C30` → `#742C0B`
- Outage severity: `#FDF1D3` → `#F9D77D` → `#F09064` → `#ED6C30` → `#C51808`
- Non-serviceable areas (Austin Energy, CPS, co-ops): `#D8D7D5` with a `#A9A8A7` outline
- Map base: light tiles on `#F0EEEB` background. The side panel can use Grounded `#1E4D2B` with white text.

---

## 3. Typography

| Role | Their font | Weights | Free substitute (Google Fonts) |
|---|---|---|---|
| Sans (everything) | **PP Neue Montreal** | 400, 500, 600, 700 | **Inter** or **Figtree** |
| Display accent | **Clarendon Wide** Bold | 700 | **Alfa Slab One** or **Zilla Slab 700** |
| Script accent | **Dahlia Blues** | 400 | **Caveat** |
| Mono | SF Mono, Monaco, Consolas | n/a | system mono |

PP Neue Montreal, Clarendon Wide and Dahlia Blues are commercial fonts, so don't hotlink Base's font files. Use the substitutes.

**How they use the accents** (sparingly):
- Clarendon Wide: tiny uppercase eyebrow labels, e.g. "BUILT IN AUSTIN, TX" (12px, Livewire green on dark)
- Dahlia Blues: small handwritten tags above sections, e.g. "How it works," "Got questions?" (18px, white)

### Type scale (their tokens)
| Token | Size | Notes |
|---|---|---|
| display-xl | clamp(3rem, 5.6vw, 5.5rem) | hero |
| display-lg | clamp(3rem, 4.7vw, 4.25rem) | |
| heading-xl | 3rem (48px) | H1 "Save money. Stay powered." weight 600, line-height 1.1 |
| heading-lg | 2.5rem (40px) | |
| heading-md | 2rem (32px) | H2s, weight 600, lh 1.2, often Grounded green |
| heading-sm | 1.25rem (20px) | H3, weight 600, lh 1.35 |
| body-lg | 1rem (16px) | body, lh 1.5, letter-spacing 0.2px |
| body-md | .875rem (14px) | nav, buttons (600) |
| body-sm | .75rem (12px) | captions; eyebrow = 500, uppercase, 0.48px tracking, grey-60 |

Headings are **600 weight, never bold-black**. Body text has a slight **0.2px letter-spacing**.

---

## 4. Shape, space, depth

- **Radius:** sm 4px · md **8px** (buttons, nav CTAs) · lg 16px · cards **20px** (most common) · 24/32px large panels · pill 9999px (toggles, chips)
- **Spacing (rem):** 0.25 · 0.5 · 0.75 · 1 · 1.25 · 1.5 · 2 · 2.5 · 3 · 4 · 5 · 6 · 8. The section gap is 1.5rem.
- **Layout:** max content width **1376px**, text columns ~576–700px, sticky header 53px
- **Shadows** are soft and rare:
  - card: `0 2px 8px rgba(0,0,0,.08)`
  - raised: `0 4px 12px rgba(0,0,0,.10)`
  - media: `0 8px 24px rgba(0,0,0,.35)`
  - floating: `0 18px 48px rgba(0,0,0,.45)`

---

## 5. Components (observed)

- **Primary CTA ("Get started"):** Livewire bg `#B2DD79`, Grounded text `#1E4D2B`, 14px/600, radius 8px
- **Secondary / ghost ("Sign in"):** transparent, white text on the dark hero, radius 8px
- **Toggle ("Grid ON / OFF"):** pill (9999px), Conduit bg, Terminal text
- **Step cards (01 / 02 / 03):** radius 20px. The active card is Grounded green; the others are white.
- **Pricing card:** big numbers (13.9¢, $695, $19/mo) with small uppercase labels above ("ENERGY," "BACKUP BATTERY")
- **Feature list:** 16px/600 H3 in Grounded green + 16px grey-60 body text
- **Hero:** full-bleed photo with dark overlay, white 48px headline, and a small social-proof row ("4.8 stars · Join 30,000+ homes")

---

## 6. Drop-in CSS (for our PHP pages)

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Zilla+Slab:wght@700&family=Caveat&display=swap');

:root {
  /* palette */
  --terminal:#292826; --grey-80:#54524F; --grey-60:#7F7D7A; --grey-40:#A9A8A7; --grey-20:#D8D7D5; --conduit:#F0EEEB;
  --grounded:#1E4D2B; --green-100:#102A17; --green-60:#77A45A; --livewire:#B2DD79; --green-5:#D6F0B4;
  --energy:#ED6C30; --orange-90:#742C0B; --orange-40:#F09064; --orange-5:#FBE3D8;
  --goldenrod:#F7C33C; --yellow-10:#F9D77D; --yellow-5:#FDF1D3;
  --texas-sky:#048EE5; --blue-10:#CCE5F5; --red-80:#C51808; --white:#FFFFFF;
  /* type */
  --font-sans:"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-display:"Zilla Slab", Georgia, serif;
  --font-script:"Caveat", cursive;
  /* shape */
  --r-sm:4px; --r-md:8px; --r-lg:16px; --r-card:20px; --r-pill:9999px;
  --shadow-card:0 2px 8px rgba(0,0,0,.08); --shadow-raised:0 4px 12px rgba(0,0,0,.10);
}
body { margin:0; background:var(--conduit); color:var(--terminal); font:400 16px/1.5 var(--font-sans); letter-spacing:.2px; }
h1,h2,h3 { font-weight:600; letter-spacing:0; }
h1 { font-size:3rem; line-height:1.1; }
h2 { font-size:2rem; line-height:1.2; color:var(--grounded); }
h3 { font-size:1.25rem; line-height:1.35; }
.eyebrow { font:500 12px/1.5 var(--font-sans); text-transform:uppercase; letter-spacing:.48px; color:var(--grey-60); }
.eyebrow--display { font-family:var(--font-display); color:var(--livewire); }
.tag-script { font:400 20px var(--font-script); }
.card { background:var(--white); border-radius:var(--r-card); box-shadow:var(--shadow-card); padding:1.5rem; }
.card--dark { background:var(--grounded); color:var(--white); }
.btn { display:inline-block; font:600 14px/21px var(--font-sans); padding:.625rem 1rem; border-radius:var(--r-md); text-decoration:none; }
.btn--primary { background:var(--livewire); color:var(--grounded); }
.btn--primary:hover { background:var(--green-60); }
.chip { border-radius:var(--r-pill); background:var(--conduit); padding:.25rem .75rem; font-size:14px; }
.stat { font-size:2.5rem; font-weight:600; color:var(--grounded); line-height:1; }
```

---

Source: https://www.basepowercompany.com/ (computed styles and CSS custom properties, read Sep 25, 2026)
