/**
 * The MediaClicks mark.
 *
 * Rendered as a CSS mask filled with `currentColor` rather than as an
 * <img>. Three reasons, all of them the brief's:
 *
 *  - One asset serves both themes. --ink is near-black on paper and near-white
 *    in dark mode, and the mark follows it automatically. Shipping a light and
 *    a dark PNG would be two files that can drift apart.
 *  - It cannot go off-palette. The mark is physically incapable of rendering
 *    in a colour the token layer did not choose — including --live, which §3
 *    reserves for time-criticality and explicitly forbids in a logo.
 *  - It inherits colour from context, so the same component works on a light
 *    surface, on the inverted avatar, and anywhere else without a variant.
 *
 * The mask is derived from the supplied artwork's luminance (the black
 * original is opaque-on-white, so its alpha carries no shape) and trimmed to
 * the mark's true bounding box — the source had ~30% dead padding, which
 * would otherwise shrink the mark inside every box it is placed in.
 */
export function LogoMark({
  size = 20,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label="MediaClicks"
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        backgroundColor: 'currentColor',
        WebkitMaskImage: 'url(/logo-mark.png)',
        maskImage: 'url(/logo-mark.png)',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        flexShrink: 0,
      }}
    />
  )
}

/** Mark plus wordmark, as the nav and login screen use it. */
export function Wordmark({
  size = 20,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <span className={`flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark size={size} />
      <span className="font-display text-title">MediaClicks</span>
    </span>
  )
}
