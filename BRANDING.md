# SwiftTrack Express Branding Guide

## Brand Identity

**Company Name:** SwiftTrack Express  
**Tagline:** Express Delivery Services  
**Industry:** Package Delivery & Logistics

## Color Palette

### Primary Colors
- **SwiftTrack Blue:** `#1e40af` - Main brand color for buttons, links, headers
- **SwiftTrack Dark Blue:** `#1e3a8a` - Gradients, hover states, darker elements
- **SwiftTrack Gold:** `#fbbf24` - Accent color for highlights, important elements

### Neutral Colors
- **Background:** `#ffffff` (White)
- **Card Background:** `#f9fafb` (Light Gray)
- **Text:** `#111827` (Dark Gray)
- **Muted Text:** `#6b7280` (Medium Gray)
- **Borders:** `#d1d5db` (Light Gray)

## Logo

**File:** `/public/swifttrack-logo.svg`  
**Dimensions:** 220px × 52px  
**Format:** SVG (scalable)

### Logo Design Elements
- Blue gradient background (#1e40af to #1e3a8a)
- Three fast-forward arrow symbols (⏩) in Gold, Light Blue, and White
- "SwiftTrack" text in white, bold, uppercase
- "EXPRESS DELIVERY" tagline in gold, smaller, uppercase, letter-spaced
- Rounded corners (4px border-radius)

### Logo Usage
```html
<img src="/swifttrack-logo.svg" alt="SwiftTrack logo" class="brand-logo" />
```

## Typography

### Font Stack
```css
font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Noto Sans;
```

### Brand Text Styling
```css
.brand-name {
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--accent);
  font-size: 18px;
}

.brand-tagline {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
```

## UI Components

### Buttons
- **Primary:** Blue background (#1e40af), white text
- **Hover:** Darker blue (#1e3a8a)
- **Border Radius:** 8px
- **Padding:** 10px 16px

### Status Badges
- **In Transit:** Blue (#1e40af)
- **Delivered:** Green (#059669)
- **Out for Delivery:** Gold (#fbbf24)
- **Delayed:** Red (#dc2626)

### Cards
- **Background:** Light gray (#f9fafb)
- **Border:** 1px solid #d1d5db
- **Border Radius:** 12px
- **Padding:** 16px

## Shipping Label Design

### 4×6 Label Layout
- **Header:** Blue gradient with white "SwiftTrack" branding
- **Service Bar:** Gold background for service type
- **Barcode:** Code128 format with tracking number
- **Postage:** Gold dollar amount ($XX.XX) in prominent meter box
- **Footer:** Contact info - swifttrackexpress.com | 1-800-SWIFTTRACK

## Contact Information

**Website:** swifttrackexpress.com  
**Phone:** 1-800-SWIFTTRACK (1-800-794-3887)  
**Email:** support@swifttrackexpress.com

## Service Names

- **Priority Mail Express** → **SwiftTrack Express**
- **Priority Mail** → **SwiftTrack Priority**
- **First Class Mail** → **SwiftTrack First Class**
- **Retail Ground** → **SwiftTrack Ground**
- **Media Mail** → **SwiftTrack Media**

## Brand Voice

- **Professional:** Business-grade delivery services
- **Reliable:** "Your package, delivered with precision"
- **Modern:** Clean, contemporary design aesthetic
- **Efficient:** Emphasis on speed and tracking transparency

---

© 2026 Express Delivery Services. All Rights Reserved.
