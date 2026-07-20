# DegenSlide → Max Yinger Dark Terminal Aesthetic

Complete redesign implementing "midnight engineer's workshop" aesthetic: near-black canvas, bone-white typography, minimal elevation, aggressive density.

## ✅ What's Complete

### **1. Design System (CSS Tokens)**
```css
/* Yinger Two-Color Palette */
--color-midnight-carbon:     #12130f   /* Canvas */
--color-bone-glow:           #e4dfda   /* All text */
--color-charcoal-vein:       #3c3c38   /* Borders, secondary UI */
--color-rose-quartz-bloom:   #f5c2c8   /* Accent (3D only) */

/* Typography (Monospace + Contrast) */
--font-arbeit-technik:  JetBrains Mono  /* Labels, telemetry */
--font-inline-vf:       Space Mono      /* Display, time readouts */
--font-arbeit-contrast: Inter            /* Body, headings */

/* Base Unit: 4px (Ultra-Compact) */
--element-gap:     4px
--card-padding:    12px
--section-gap:     64px
```

### **2. Layout (Edge-to-Edge, Full-Bleed)**
- ✅ Removed phone shell (no max-width, no border-radius)
- ✅ Wordmark (DEGENSLIDE) top-left
- ✅ Profile dropdown top-right (NFT avatar or ⊙)
- ✅ Minimal nav borders (charcoal-vein only)
- ✅ 0px border-radius everywhere (sharp, terminal aesthetic)
- ✅ No elevation, no shadows, no blur effects

### **3. New Components**

#### **StoryCard** (`src/components/StoryCard.jsx`)
Displays individual whale copy or user trade:
- Token image (gradient fallback with initials)
- Token symbol ($SOL, $MON)
- Whale alias or user label
- P&L amount + percent
- Profit/loss indicator (↗ green, ↘ red)
- Timestamp
- Compact sizing (sm=140px wide, md=flexible)

#### **StoryFeed** (`src/components/StoryFeed.jsx`)
Horizontal-scrolling activity feed:
- Telemetry label ("RECENT ACTIVITY")
- Multiple story cards side-by-side
- Scrollbar hidden (Yinger principle)
- Integrated in deck view below whale rail

#### **ProfileDropdown** (`src/components/ProfileDropdown.jsx`)
Top-right wallet & settings menu:
- Avatar click to toggle dropdown
- Wallet address (copyable)
- Settings button → Profile page
- Disconnect button
- Minimal styling, no elevation

#### **UserAvatar** (`src/components/UserAvatar.jsx`)
Profile picture display:
- Best NFT from wallet (placeholder for API integration)
- Deterministic gradient + initials if no NFT
- Clickable to change
- Respects Yinger square/minimal aesthetic

#### **TokenImage** (`src/components/TokenImage.jsx`)
Fetches & displays token visuals:
- **API**: DexScreener for token images
- **Chains**: Monad, Solana
- **Fallback**: Deterministic gradient + symbol initial
- **Sizing**: Flexible (48px-100px)
- **Error handling**: Graceful fallback if fetch fails

### **4. Story Feed Integration**
```javascript
<StoryFeed
  whaleStories={[
    {
      id: 1,
      type: 'copy',
      whaleAlias: 'Bold Sniper',
      tokenSymbol: 'SOL',
      tokenAddress: 'So111...1112',
      chain: 'solana',
      pnl: 450,
      pnlPercent: 12.5,
      timestamp: '5m'
    }
  ]}
  userStories={[]}
/>
```

### **5. Visual Improvements**
- ✅ Token symbols now visible in story cards
- ✅ P&L amounts show profit/loss clearly
- ✅ Whale names/aliases displayed
- ✅ Timestamps for activity context
- ✅ Gradient backgrounds for missing token images
- ✅ Monospace telemetry labels (RECENT ACTIVITY, timestamps)

## 🔄 API Integration Ready (Next Phase)

### **DexScreener Token Images**
```javascript
// Already implemented in TokenImage.jsx
const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
// Returns: pair.baseToken.image or pair.quoteToken.image
```

### **NFT Wallet Queries (Coming)**
```javascript
// Pseudo-code for future integration
const nfts = await fetch(`https://api.mainnet-beta.solana.com/`, {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTokenAccountsByOwner',
    params: [wallet, { programId: 'TokenkegQfeZyiNwAJsyFbPVwwQQforrxWWmziucNd' }]
  })
});
```

## 📝 Components & Files

| Component | Path | Purpose |
|-----------|------|---------|
| **StoryCard** | `src/components/StoryCard.jsx` | Individual story with token image, P&L |
| **StoryFeed** | `src/components/StoryFeed.jsx` | Horizontal scroll feed of stories |
| **ProfileDropdown** | `src/components/ProfileDropdown.jsx` | Wallet + settings menu (top-right) |
| **UserAvatar** | `src/components/UserAvatar.jsx` | Profile picture display |
| **TokenImage** | `src/components/TokenImage.jsx` | Token image fetcher (DexScreener) |
| **CSS Tokens** | `src/index.css` | Yinger palette + typography scale |

## 🎨 Visual Hierarchy (Yinger Principle)

**Density Priority:**
1. **Story feed** (top) — Most visual interest, token images
2. **Whale rail** — Circular avatars, visual anchors
3. **Tier filter** — Telemetry labels, compact controls
4. **Card deck** — Hero card with token visuals
5. **Action buttons** — Minimal, no text, icons only
6. **Bottom nav** — Minimal underline active state

**No Elevation, No Shadows:**
- All UI sits flush on midnight canvas
- Depth from layout spacing only
- 3D artifacts (future) will be the only elevation signal

## 🚀 Next Steps (Post-UI)

### **Phase 1: API Integration**
- [ ] Fetch real NFT images from Phantom/Magic Eden
- [ ] Connect to actual whale transaction data
- [ ] Real P&L calculations from trade history
- [ ] Monad RPC integration for token metadata

### **Phase 2: Interactions**
- [ ] Accept/Reject swap-style story cards
- [ ] Share wins/losses as stories
- [ ] Follow whale activity feeds
- [ ] User profile customization (NFT PP selection)

### **Phase 3: Social Features**
- [ ] Story comments/reactions
- [ ] Leaderboard for best traders
- [ ] Whale tracking notifications
- [ ] Share story cards to social media

## 🔗 Branch Status

- **Branch**: `ui/crimson-redesign` (was crimson, now Yinger)
- **Commits**: 2 (Yinger aesthetic + TokenImage)
- **Status**: Ready to merge into `main`

```bash
git checkout main
git merge ui/crimson-redesign
```

## 📸 Screenshots

- `scratch/screens/yinger_deck.png` — Main deck view with story feed
- Shows: Story cards with token images, whale rail, action buttons
- Aesthetic: Midnight canvas, bone-white text, minimal borders

## ⚙️ Technical Notes

### **Performance**
- TokenImage fetches async (non-blocking)
- Gradients are CSS-only (zero overhead)
- No external image CDN dependencies
- DexScreener API is free & public

### **Accessibility**
- All text uses `var(--color-bone-glow)` (meets WCAG AA)
- 12px minimum font size (readable)
- Icon + text labels (not icon-only on critical UX)
- Monospace for telemetry (readable at small sizes)

### **Browser Support**
- Modern CSS Grid/Flexbox ✅
- CSS Custom Properties ✅
- Async/await (tokenImage fetches) ✅
- Fallback colors: solid, no gradients needed

---

**Next review**: After API integration phase  
**Owner**: DegenSlide Team  
**Last updated**: 2026-07-20
